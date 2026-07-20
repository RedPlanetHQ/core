import type {FastifyPluginAsync} from 'fastify';
import {spawn, type ChildProcess} from 'node:child_process';
import {readFileSync, existsSync} from 'node:fs';
import {gatewayLog} from '@/server/gateway-log';

/**
 * LLM subscription proxy routes (mounted at `/api/llmproxy`).
 *
 *   GET  /api/llmproxy/providers        → provider port config (public — needed
 *                                          by the CLI before login)
 *   POST /api/llmproxy/login/:provider  → spawn CLIProxyAPI --<provider>-login,
 *                                          capture the OAuth URL from stdout,
 *                                          keep the process alive waiting for
 *                                          the OAuth callback (which arrives
 *                                          via nginx from the CLI's local
 *                                          server → CLIProxyAPI's internal port).
 *   GET  /api/llmproxy/login/:provider/status
 *                                       → poll for whether the login process
 *                                          has finished (success or failure).
 *
 * Auth is handled upstream (`makeAuthHook`); these handlers assume the caller
 * already passed the gateway's security key.
 *
 * The /providers endpoint is exempted from auth so the CLI can bootstrap
 * before it has the security key — see auth.ts.
 */

const PROVIDERS_JSON = '/etc/gateway/llmproxy-providers.json';
const CLIPROXY_BIN = '/CLIProxyAPI/CLIProxyAPI';
const CLIPROXY_CONFIG = '/CLIProxyAPI/config.yaml';

interface ProviderMeta {
	flow: 'callback' | 'device-code';
	loginFlag: string;
	displayName: string;
	/** callback flow only */
	port?: number;
	/** callback flow only */
	callbackPath?: string;
}

interface ProvidersConfig {
	providers: Record<string, ProviderMeta>;
}

interface ActiveLogin {
	provider: string;
	proc: ChildProcess;
	authUrl: string | null;
	/** device-code flow only: the short code the user must type on the auth page */
	userCode: string | null;
	status: 'pending' | 'awaiting-callback' | 'awaiting-device-code' | 'completed' | 'failed';
	error: string | null;
	stdoutBuffer: string;
	startedAt: number;
}

const activeLogins = new Map<string, ActiveLogin>();

function loadProviders(): ProvidersConfig | null {
	if (!existsSync(PROVIDERS_JSON)) return null;
	try {
		return JSON.parse(readFileSync(PROVIDERS_JSON, 'utf8')) as ProvidersConfig;
	} catch (err) {
		gatewayLog(
			`[llmproxy] failed to parse ${PROVIDERS_JSON}: ${err instanceof Error ? err.message : String(err)}`,
		);
		return null;
	}
}

/**
 * Extract the OAuth authorization URL from CLIProxyAPI's stdout stream. The
 * upstream binary prints something like:
 *
 *   Please visit the following URL to authenticate:
 *   https://claude.ai/oauth/authorize?client_id=...
 *
 * We grep for the first https:// URL after buffering enough output.
 */
function extractAuthUrl(buffer: string): string | null {
	const match = buffer.match(/https:\/\/[^\s"']+/);
	return match ? match[0] : null;
}

/**
 * Extract the short user code from device-code flow output. xAI (and kimi)
 * print `Then enter this code: <CODE>` after the verification URL. Match on
 * that anchor phrase to avoid catching unrelated tokens.
 */
function extractUserCode(buffer: string): string | null {
	const match = buffer.match(/Then enter this code:\s*(\S+)/);
	return match ? match[1].trim() : null;
}

async function startLogin(provider: string, meta: ProviderMeta): Promise<ActiveLogin> {
	// If there's already an active login for this provider, reuse it — the CLI
	// may retry the request, and we don't want to spawn duplicate subprocesses
	// fighting for the same port.
	const existing = activeLogins.get(provider);
	if (existing && (existing.status === 'pending' || existing.status === 'awaiting-callback')) {
		return existing;
	}

	if (!existsSync(CLIPROXY_BIN)) {
		throw new Error(
			`CLIProxyAPI binary missing at ${CLIPROXY_BIN} — is this the bundled gateway image?`,
		);
	}

	gatewayLog(`[llmproxy] starting ${meta.loginFlag} subprocess`);
	const proc = spawn(
		CLIPROXY_BIN,
		['--config', CLIPROXY_CONFIG, '-no-browser', meta.loginFlag],
		{stdio: ['ignore', 'pipe', 'pipe']},
	);

	const login: ActiveLogin = {
		provider,
		proc,
		authUrl: null,
		userCode: null,
		status: 'pending',
		error: null,
		stdoutBuffer: '',
		startedAt: Date.now(),
	};

	// Device-code providers publish both a URL and a short code; callback
	// providers only publish the URL. We stop the "waiting for output" loop
	// once we've captured the minimum required for this flow.
	const needsUserCode = meta.flow === 'device-code';

	proc.stdout.on('data', (chunk: Buffer) => {
		const text = chunk.toString('utf8');
		login.stdoutBuffer += text;
		process.stdout.write(`[cliproxy-login:${provider}] ${text}`);
		if (!login.authUrl) {
			const url = extractAuthUrl(login.stdoutBuffer);
			if (url) {
				login.authUrl = url;
				login.status = needsUserCode ? 'awaiting-device-code' : 'awaiting-callback';
				gatewayLog(`[llmproxy] ${provider} auth URL captured`);
			}
		}
		if (needsUserCode && !login.userCode) {
			const code = extractUserCode(login.stdoutBuffer);
			if (code) {
				login.userCode = code;
				gatewayLog(`[llmproxy] ${provider} user code captured`);
			}
		}
	});

	proc.stderr.on('data', (chunk: Buffer) => {
		process.stderr.write(`[cliproxy-login:${provider}] ${chunk.toString('utf8')}`);
	});

	proc.on('exit', (code) => {
		if (code === 0) {
			login.status = 'completed';
			gatewayLog(`[llmproxy] ${provider} login completed`);
		} else {
			login.status = 'failed';
			login.error = `CLIProxyAPI exited with code ${code}`;
			gatewayLog(`[llmproxy] ${provider} login failed with exit code ${code}`);
		}
		// Leave the entry in the map for a short while so the CLI can poll the
		// final status; garbage-collect after a minute.
		setTimeout(() => {
			if (activeLogins.get(provider) === login) activeLogins.delete(provider);
		}, 60_000);
	});

	activeLogins.set(provider, login);

	// Wait up to 15s for the required stdout to appear. For device-code we
	// need both URL and user code; for callback we only need the URL. If the
	// subprocess dies or times out before we've captured everything, fail.
	const deadline = Date.now() + 15_000;
	const ready = () => {
		if (!login.authUrl) return false;
		if (needsUserCode && !login.userCode) return false;
		return true;
	};
	while (!ready() && Date.now() < deadline && login.status !== 'failed') {
		await new Promise((r) => setTimeout(r, 100));
	}

	if (!ready()) {
		proc.kill();
		activeLogins.delete(provider);
		throw new Error(
			`Timed out waiting for CLIProxyAPI to print login details. Last output:\n${login.stdoutBuffer.slice(-500)}`,
		);
	}

	return login;
}

export const llmproxyRoutes: FastifyPluginAsync = async (app) => {
	// ---- list providers (used by the CLI to discover ports) ----
	app.get('/providers', async (_req, reply) => {
		const cfg = loadProviders();
		if (!cfg) {
			reply.code(503);
			return {
				ok: false,
				error: 'llmproxy providers config not found — is this the bundled gateway image?',
			};
		}
		return {ok: true, ...cfg};
	});

	// ---- start login flow for a provider ----
	app.post<{Params: {provider: string}}>(
		'/login/:provider',
		async (req, reply) => {
			const {provider} = req.params;
			const cfg = loadProviders();
			if (!cfg) {
				reply.code(503);
				return {ok: false, error: 'llmproxy providers config not available'};
			}
			const meta = cfg.providers[provider];
			if (!meta) {
				reply.code(404);
				return {
					ok: false,
					error: `unknown provider "${provider}" (available: ${Object.keys(cfg.providers).join(', ')})`,
				};
			}

			try {
				const login = await startLogin(provider, meta);
				return {
					ok: true,
					provider,
					flow: meta.flow,
					authUrl: login.authUrl,
					userCode: login.userCode, // null for callback flows
					port: meta.port ?? null,
					callbackPath: meta.callbackPath
						? `/llmproxy-oauth/${provider}${meta.callbackPath}`
						: null,
				};
			} catch (err) {
				reply.code(500);
				return {
					ok: false,
					error: err instanceof Error ? err.message : String(err),
				};
			}
		},
	);

	// ---- poll login status ----
	app.get<{Params: {provider: string}}>(
		'/login/:provider/status',
		async (req) => {
			const {provider} = req.params;
			const login = activeLogins.get(provider);
			if (!login) {
				return {ok: true, status: 'idle' as const};
			}
			return {
				ok: true,
				status: login.status,
				error: login.error,
				elapsedMs: Date.now() - login.startedAt,
			};
		},
	);

	// ---- cancel an in-flight login ----
	app.delete<{Params: {provider: string}}>(
		'/login/:provider',
		async (req) => {
			const {provider} = req.params;
			const login = activeLogins.get(provider);
			if (!login) return {ok: true, cancelled: false};
			login.proc.kill();
			activeLogins.delete(provider);
			return {ok: true, cancelled: true};
		},
	);
};
