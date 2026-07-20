import {useEffect} from 'react';
import {useApp} from 'ink';
import * as p from '@clack/prompts';
import chalk from 'chalk';
import zod from 'zod';
import http from 'node:http';
import {listGateways, type GatewayInfo} from '@/server/api/gateways';

export const description =
	'Log in to a subscription (Claude, Codex, Antigravity, xAI) on a bundled gateway. Drives CLIProxyAPI’s OAuth flow through the gateway so tokens land directly on it.';

/**
 * Providers supported by the built-in gateway llmproxy. Kept as a string
 * enum for CLI validation, but the authoritative list lives in
 * `<gateway>/api/llmproxy/providers` — we bail with a clean error if the
 * requested provider isn't in the gateway's response.
 */
const LOGIN_CHOICES = ['claude', 'codex', 'antigravity', 'xai'] as const;
type LoginChoice = (typeof LOGIN_CHOICES)[number];

export const options = zod.object({
	login: zod
		.enum(LOGIN_CHOICES)
		.describe('Which subscription to log in to. One of: claude, codex, antigravity, xai.'),
	gateway: zod
		.string()
		.optional()
		.describe('Gateway name or id (only needed when multiple gateways are registered).'),
});

type Props = {options: zod.infer<typeof options>};

interface ProviderMeta {
	flow: 'callback' | 'device-code';
	loginFlag: string;
	displayName: string;
	port?: number;
	callbackPath?: string;
}

interface StartLoginResponse {
	ok: boolean;
	flow?: 'callback' | 'device-code';
	authUrl?: string;
	userCode?: string | null;
	port?: number | null;
	callbackPath?: string | null;
	error?: string;
}

interface StatusResponse {
	ok: boolean;
	status: 'idle' | 'pending' | 'awaiting-callback' | 'awaiting-device-code' | 'completed' | 'failed';
	error?: string | null;
	elapsedMs?: number;
}

/** Turn `https://foo/` + `/api/x` into `https://foo/api/x` (no double slash). */
function joinUrl(base: string, path: string): string {
	return `${base.replace(/\/$/, '')}${path.startsWith('/') ? path : `/${path}`}`;
}

async function fetchProviders(
	gatewayUrl: string,
): Promise<Record<string, ProviderMeta>> {
	const res = await fetch(joinUrl(gatewayUrl, '/api/llmproxy/providers'), {
		signal: AbortSignal.timeout(10_000),
	});
	if (!res.ok) {
		throw new Error(
			`gateway did not return provider list (HTTP ${res.status}). Is this the bundled gateway image (with cliproxy)?`,
		);
	}
	const body = (await res.json()) as {providers?: Record<string, ProviderMeta>};
	if (!body.providers) throw new Error('malformed /api/llmproxy/providers response');
	return body.providers;
}

async function startLogin(
	gatewayUrl: string,
	provider: LoginChoice,
): Promise<StartLoginResponse> {
	const res = await fetch(joinUrl(gatewayUrl, `/api/llmproxy/login/${provider}`), {
		method: 'POST',
		signal: AbortSignal.timeout(30_000),
	});
	const body = (await res.json()) as StartLoginResponse;
	if (!res.ok || !body.ok) {
		throw new Error(body.error ?? `gateway returned HTTP ${res.status}`);
	}
	return body;
}

async function pollStatus(
	gatewayUrl: string,
	provider: LoginChoice,
): Promise<StatusResponse> {
	const res = await fetch(joinUrl(gatewayUrl, `/api/llmproxy/login/${provider}/status`), {
		signal: AbortSignal.timeout(5_000),
	});
	return (await res.json()) as StatusResponse;
}

/**
 * Start a tiny local HTTP server on the OAuth callback port. When the user's
 * browser is redirected to `http://localhost:<port>/callback?code=...` after
 * approving on the provider's OAuth page, this catches the request, forwards
 * the raw query to the gateway (`/llmproxy-oauth/<provider>/callback?...`),
 * and returns a friendly page to the browser.
 */
function bindLocalCallback(
	provider: LoginChoice,
	port: number,
	callbackPath: string,
	gatewayUrl: string,
): {close: () => Promise<void>; received: Promise<{ok: boolean; error?: string}>} {
	let resolve: (value: {ok: boolean; error?: string}) => void;
	const received = new Promise<{ok: boolean; error?: string}>((r) => {
		resolve = r;
	});

	const server = http.createServer(async (req, res) => {
		const path = req.url ?? '/';
		// Only forward the actual callback — ignore favicon.ico, HEAD probes, etc.
		// Match `callbackPath` optionally followed by `?...` (query string).
		const pathOnly = path.split('?')[0] ?? path;
		if (pathOnly !== callbackPath) {
			res.writeHead(404, {'content-type': 'text/plain'});
			res.end('not the callback');
			return;
		}

		const query = path.includes('?') ? path.slice(path.indexOf('?')) : '';
		const targetUrl = joinUrl(
			gatewayUrl,
			`/llmproxy-oauth/${provider}${callbackPath}${query}`,
		);

		try {
			const forward = await fetch(targetUrl, {
				method: 'GET',
				signal: AbortSignal.timeout(30_000),
				redirect: 'manual',
			});
			// CLIProxyAPI often responds with a 302 redirect to its own success
			// page after processing the code, so anything 2xx or 3xx means the
			// callback was delivered. Only 4xx/5xx indicate a real failure.
			// Actual login success/failure is confirmed by the status poll —
			// we just report "callback got through" here.
			const delivered = forward.status < 400;
			res.writeHead(delivered ? 200 : forward.status, {'content-type': 'text/html'});
			res.end(`<!doctype html>
<meta charset="utf-8">
<title>Login complete</title>
<div style="font-family: -apple-system, sans-serif; max-width: 480px; margin: 8rem auto; text-align: center;">
  <h2>${delivered ? 'Login complete' : 'Login failed'}</h2>
  <p>You can close this tab and return to your terminal.</p>
</div>`);
			resolve({
				ok: delivered,
				error: delivered ? undefined : `gateway returned HTTP ${forward.status}`,
			});
		} catch (err) {
			res.writeHead(502, {'content-type': 'text/plain'});
			res.end('failed to relay callback to gateway');
			resolve({ok: false, error: err instanceof Error ? err.message : String(err)});
		}
	});

	server.listen(port, '127.0.0.1');

	const close = () =>
		new Promise<void>((r) => {
			server.close(() => r());
		});

	return {close, received};
}

async function pickGateway(name?: string): Promise<GatewayInfo | null> {
	const gateways = await listGateways();
	if (gateways.length === 0) {
		p.log.error(
			`No gateways registered with your CORE workspace. Deploy one first (${chalk.cyan(
				'corebrain gateway setup',
			)}) or register via the webapp.`,
		);
		return null;
	}

	if (name) {
		const match = gateways.find((g) => g.id === name || g.name === name);
		if (!match) {
			p.log.error(
				`No gateway named or ID'd ${chalk.bold(name)}. Available:\n  ${gateways
					.map((g) => `${g.name} (${g.id})`)
					.join('\n  ')}`,
			);
			return null;
		}
		return match;
	}

	if (gateways.length === 1) return gateways[0];

	const choice = await p.select({
		message: 'Which gateway do you want to log in to?',
		options: gateways.map((g) => ({
			value: g.id,
			label: `${g.name} (${g.baseUrl})`,
			hint: g.status === 'CONNECTED' ? 'connected' : 'disconnected',
		})),
	});
	if (p.isCancel(choice)) return null;
	return gateways.find((g) => g.id === choice) ?? null;
}

async function runLoginFlow(opts: zod.infer<typeof options>): Promise<void> {
	const gateway = await pickGateway(opts.gateway);
	if (!gateway) {
		process.exitCode = 1;
		return;
	}

	p.log.info(`Using gateway ${chalk.bold(gateway.name)} at ${gateway.baseUrl}`);

	const providersSpinner = p.spinner();
	providersSpinner.start('Fetching provider list from gateway...');
	let providers: Record<string, ProviderMeta>;
	try {
		providers = await fetchProviders(gateway.baseUrl);
	} catch (err) {
		providersSpinner.stop(chalk.red('Failed to reach gateway.'));
		p.log.error(err instanceof Error ? err.message : String(err));
		process.exitCode = 1;
		return;
	}
	providersSpinner.stop(`Gateway supports ${Object.keys(providers).length} providers`);

	const meta = providers[opts.login];
	if (!meta) {
		p.log.error(
			`Gateway does not expose the ${chalk.bold(opts.login)} provider. Available: ${Object.keys(providers).join(', ')}`,
		);
		process.exitCode = 1;
		return;
	}

	// For callback flow: bind the local port BEFORE asking the gateway to
	// start the login. If the port is taken, we'd rather fail here than after
	// spawning the subprocess.
	let localServer: ReturnType<typeof bindLocalCallback> | null = null;
	if (meta.flow === 'callback') {
		if (!meta.port || !meta.callbackPath) {
			p.log.error(
				`Provider ${opts.login} is marked as callback flow but missing port/callbackPath in the gateway config.`,
			);
			process.exitCode = 1;
			return;
		}
		try {
			localServer = bindLocalCallback(
				opts.login,
				meta.port,
				meta.callbackPath,
				gateway.baseUrl,
			);
		} catch (err) {
			p.log.error(
				`Could not bind localhost:${meta.port} for the OAuth callback. Another process may be listening there. ${err instanceof Error ? err.message : String(err)}`,
			);
			process.exitCode = 1;
			return;
		}
	}

	const loginSpinner = p.spinner();
	loginSpinner.start('Asking gateway to start the login flow...');
	let start: StartLoginResponse;
	try {
		start = await startLogin(gateway.baseUrl, opts.login);
	} catch (err) {
		loginSpinner.stop(chalk.red('Gateway rejected the login request.'));
		p.log.error(err instanceof Error ? err.message : String(err));
		if (localServer) await localServer.close();
		process.exitCode = 1;
		return;
	}
	loginSpinner.stop('Got login details from gateway');

	// Print the URL raw (no box border) so the user can triple-click and copy
	// without dragging in decorative characters — long OAuth URLs would
	// otherwise wrap across `p.note()`'s vertical bar and break selection.
	console.log();
	console.log(chalk.bold(`Sign in to ${meta.displayName} — open this URL:`));
	console.log();
	console.log(chalk.cyan(start.authUrl ?? ''));
	console.log();
	if (meta.flow === 'device-code' && start.userCode) {
		console.log(
			`${chalk.bold('Then enter this code on the page:')}  ${chalk.yellow.bold(start.userCode)}`,
		);
	} else if (meta.flow === 'callback') {
		console.log(
			chalk.dim(
				`This CLI is listening on http://localhost:${meta.port}${meta.callbackPath} and will forward the OAuth callback to your gateway.`,
			),
		);
	}
	console.log();

	const waitSpinner = p.spinner();
	waitSpinner.start(
		meta.flow === 'device-code'
			? 'Waiting for you to approve on the provider website...'
			: 'Waiting for you to complete the browser flow...',
	);

	// The truthful signal for "is this login done?" is the status poll —
	// the gateway subprocess transitions to `completed` / `failed` after
	// exchanging the code. The local callback resolving just tells us the
	// browser redirected; the actual token exchange happens after. So we
	// poll status regardless, and only use the callback to speed up the
	// last few seconds.
	const timeoutMs = 5 * 60_000;
	const startedAt = Date.now();
	let callbackReported: {ok: boolean; error?: string} | null = null;
	if (localServer) {
		localServer.received.then((r) => {
			callbackReported = r;
		});
	}

	let outcome: {ok: boolean; error?: string} | null = null;
	while (Date.now() - startedAt < timeoutMs && !outcome) {
		await new Promise((r) => setTimeout(r, 2_000));
		try {
			const status = await pollStatus(gateway.baseUrl, opts.login);
			if (status.status === 'completed') {
				outcome = {ok: true};
				break;
			}
			if (status.status === 'failed') {
				outcome = {ok: false, error: status.error ?? 'unknown gateway error'};
				break;
			}
			if (status.status === 'idle') {
				// Subprocess already exited and its entry was GC'd, but we never
				// got a completed/failed reading. Trust the callback report.
				if (callbackReported) {
					outcome = callbackReported;
					break;
				}
			}
		} catch {
			// transient poll failure — keep waiting
		}
	}

	if (localServer) await localServer.close();

	if (!outcome) {
		waitSpinner.stop(chalk.red('Timed out waiting for authorization.'));
		p.log.error(
			`No response within ${timeoutMs / 1000}s. Re-run the command to try again.`,
		);
		process.exitCode = 1;
		return;
	}

	if (!outcome.ok) {
		waitSpinner.stop(chalk.red('Login failed.'));
		p.log.error(outcome.error ?? 'unknown error');
		process.exitCode = 1;
		return;
	}

	waitSpinner.stop(chalk.green('Login complete'));

	p.note(
		[
			`${chalk.bold('BYOK base URL:')} ${gateway.baseUrl.replace(/\/$/, '')}/llmproxy/v1`,
			`${chalk.bold('API key:')}       your ${chalk.dim('COREBRAIN_GATEWAY_SECURITY_KEY')} value`,
			'',
			`Paste both into ${chalk.cyan('CORE → Workspace Settings → Models → BYOK')}.`,
			`Then set a workspace model like ${chalk.cyan(`openai/${defaultModelFor(opts.login)}`)}.`,
		].join('\n'),
		'Wire into CORE',
	);
}

function defaultModelFor(provider: LoginChoice): string {
	switch (provider) {
		case 'claude':
			return 'claude-sonnet-4-6';
		case 'codex':
			return 'gpt-4o';
		case 'antigravity':
			return 'gemini-2.0-flash';
		case 'xai':
			return 'grok-2-latest';
		default:
			return provider;
	}
}

export default function GatewayLLMProxy({options: opts}: Props) {
	const {exit} = useApp();
	useEffect(() => {
		runLoginFlow(opts).finally(() => setTimeout(() => exit(), 100));
	}, [exit, opts]);
	return null;
}
