import fs from 'node:fs';
import {getProfileDir, getBrowserExecutable, getSessionConfig} from '@/utils/browser-config';
import {gatewayLog} from '@/server/gateway-log';

interface BrowserSession {
	context: import('playwright').BrowserContext;
	page: import('playwright').Page;
	sessionName: string;
	profile: string;
	profileDir: string;
	headed: boolean;
	createdAt: number;
	/**
	 * Chrome DevTools Protocol WebSocket endpoint for the launched Chromium.
	 * Captured at launch time by passing `--remote-debugging-port=0` and
	 * polling `http://127.0.0.1:<port>/json/version`. Used by the per-task
	 * Browser tab to render a live screencast + forward Input events for
	 * the "take control" feature.
	 */
	cdpWsEndpoint?: string;
	cdpHttpEndpoint?: string;
	cdpPort?: number;
}

const sessionMap = new Map<string, BrowserSession>();

/**
 * Capture the CDP WebSocket endpoint for the Chromium that Playwright
 * launched in `profileDir`. Chromium writes `<profileDir>/DevToolsActivePort`
 * when started with `--remote-debugging-port=0` — first line is the actual
 * port. Once we have the port we hit `http://127.0.0.1:<port>/json/version`
 * for `webSocketDebuggerUrl`.
 *
 * `Browser.wsEndpoint()` doesn't exist on `Browser` returned by
 * `launchPersistentContext` (it's on `BrowserServer`), so the port-scan is
 * the only reliable approach for our launch shape.
 *
 * Polled because `DevToolsActivePort` lands a few hundred ms after
 * `launchPersistentContext` resolves on some setups. Best-effort — failure
 * leaves `cdpWsEndpoint` undefined and the live-view UI shows "no
 * inspector available".
 */
async function captureCdpEndpoint(
	profileDir: string,
): Promise<{port: number; wsEndpoint: string; httpEndpoint: string} | null> {
	const portFile = `${profileDir}/DevToolsActivePort`;
	const deadline = Date.now() + 5_000;
	while (Date.now() < deadline) {
		try {
			if (fs.existsSync(portFile)) {
				const contents = fs.readFileSync(portFile, 'utf8').trim();
				const portStr = contents.split('\n')[0];
				const port = portStr ? parseInt(portStr, 10) : NaN;
				if (Number.isFinite(port) && port > 0) {
					const httpEndpoint = `http://127.0.0.1:${port}`;
					const res = await fetch(`${httpEndpoint}/json/version`);
					if (res.ok) {
						const body = (await res.json()) as {webSocketDebuggerUrl?: string};
						if (body.webSocketDebuggerUrl) {
							gatewayLog(
								`browser cdp endpoint: ${body.webSocketDebuggerUrl}`,
							);
							return {
								port,
								wsEndpoint: body.webSocketDebuggerUrl,
								httpEndpoint,
							};
						}
					}
				}
			}
		} catch {
			/* try again */
		}
		await new Promise(r => setTimeout(r, 100));
	}
	gatewayLog(`browser cdp endpoint: no endpoint after 5s for ${profileDir}`);
	return null;
}

export async function getOrLaunchSession(
	sessionName: string,
	headed = false,
): Promise<{session: BrowserSession; error?: string}> {
	// Return existing session if alive
	const existing = sessionMap.get(sessionName);
	if (existing) {
		if (existing.page.isClosed()) {
			existing.page = await existing.context.newPage();
		}
		return {session: existing};
	}

	// Look up profile from session config
	const sessionConfig = getSessionConfig(sessionName);
	if (!sessionConfig) {
		return {
			session: undefined as unknown as BrowserSession,
			error: `Session "${sessionName}" is not configured. Run: corebrain browser create-session ${sessionName} --profile <profile>`,
		};
	}

	try {
		const {chromium} = await import('playwright');

		const profileDir = getProfileDir(sessionConfig.profile);
		fs.mkdirSync(profileDir, {recursive: true});

		const browserConfig = getBrowserExecutable();
		const launchOptions: import('playwright').LaunchOptions = {
			headless: !headed,
			args: ['--remote-debugging-port=0'],
		};
		if (browserConfig.type !== 'default' && browserConfig.path) {
			launchOptions.executablePath = browserConfig.path;
		}

		const context = await chromium.launchPersistentContext(profileDir, launchOptions);

		context.on('close', () => {
			sessionMap.delete(sessionName);
		});

		const page = context.pages()[0] ?? (await context.newPage());

		const cdp = await captureCdpEndpoint(profileDir);

		const session: BrowserSession = {
			context,
			page,
			sessionName,
			profile: sessionConfig.profile,
			profileDir,
			headed: false,
			createdAt: Date.now(),
			cdpPort: cdp?.port,
			cdpWsEndpoint: cdp?.wsEndpoint,
			cdpHttpEndpoint: cdp?.httpEndpoint,
		};

		sessionMap.set(sessionName, session);
		return {session};
	} catch (err) {
		return {
			session: undefined as unknown as BrowserSession,
			error: err instanceof Error ? err.message : 'Failed to launch browser',
		};
	}
}

export async function launchSession(
	sessionName: string,
	headed: boolean,
): Promise<{session: BrowserSession; error?: string}> {
	// Close existing instance if any
	const existing = sessionMap.get(sessionName);
	if (existing) {
		await existing.context.close().catch(() => {});
		sessionMap.delete(sessionName);
	}

	const sessionConfig = getSessionConfig(sessionName);
	if (!sessionConfig) {
		return {
			session: undefined as unknown as BrowserSession,
			error: `Session "${sessionName}" is not configured. Run: corebrain browser create-session ${sessionName} --profile <profile>`,
		};
	}

	try {
		const {chromium} = await import('playwright');

		const profileDir = getProfileDir(sessionConfig.profile);
		fs.mkdirSync(profileDir, {recursive: true});

		const browserConfig = getBrowserExecutable();
		const launchOptions: import('playwright').LaunchOptions = {
			headless: !headed,
			args: ['--remote-debugging-port=0'],
		};
		if (browserConfig.type !== 'default' && browserConfig.path) {
			launchOptions.executablePath = browserConfig.path;
		}

		const context = await chromium.launchPersistentContext(profileDir, launchOptions);

		context.on('close', () => {
			sessionMap.delete(sessionName);
		});

		const page = context.pages()[0] ?? (await context.newPage());

		const cdp = await captureCdpEndpoint(profileDir);

		const session: BrowserSession = {
			context,
			page,
			sessionName,
			profile: sessionConfig.profile,
			profileDir,
			headed,
			createdAt: Date.now(),
			cdpPort: cdp?.port,
			cdpWsEndpoint: cdp?.wsEndpoint,
			cdpHttpEndpoint: cdp?.httpEndpoint,
		};

		sessionMap.set(sessionName, session);
		return {session};
	} catch (err) {
		return {
			session: undefined as unknown as BrowserSession,
			error: err instanceof Error ? err.message : 'Failed to launch browser',
		};
	}
}

/**
 * Read the live CDP info for a session — used by the CDP WS proxy to find
 * which `ws://localhost:<port>/devtools/...` to forward frames to. Returns
 * null when the session isn't running.
 */
export function getSessionCdpInfo(
	sessionName: string,
): {wsEndpoint: string; httpEndpoint: string; port: number} | null {
	const s = sessionMap.get(sessionName);
	if (!s || !s.cdpWsEndpoint || !s.cdpHttpEndpoint || !s.cdpPort) return null;
	return {
		wsEndpoint: s.cdpWsEndpoint,
		httpEndpoint: s.cdpHttpEndpoint,
		port: s.cdpPort,
	};
}

export async function closeSession(
	sessionName: string,
): Promise<{success: boolean; error?: string}> {
	const session = sessionMap.get(sessionName);
	if (!session) {
		return {success: false, error: `Session "${sessionName}" is not running`};
	}
	try {
		await session.context.close();
		sessionMap.delete(sessionName);
		return {success: true};
	} catch (err) {
		sessionMap.delete(sessionName);
		return {
			success: false,
			error: err instanceof Error ? err.message : 'Failed to close session',
		};
	}
}

export async function closeAllSessions(): Promise<{success: boolean}> {
	const names = [...sessionMap.keys()];
	await Promise.allSettled(names.map(async name => closeSession(name)));
	return {success: true};
}

export function getLiveSessions(): string[] {
	return [...sessionMap.keys()];
}
