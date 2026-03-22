import fs from 'node:fs';
import {getProfileDir, getBrowserExecutable, getSessionConfig} from '@/utils/browser-config';

interface BrowserSession {
	context: import('playwright').BrowserContext;
	page: import('playwright').Page;
	sessionName: string;
	profile: string;
	profileDir: string;
	headed: boolean;
	createdAt: number;
}

const sessionMap = new Map<string, BrowserSession>();

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
		};
		if (browserConfig.type !== 'default' && browserConfig.path) {
			launchOptions.executablePath = browserConfig.path;
		}

		const context = await chromium.launchPersistentContext(profileDir, launchOptions);

		context.on('close', () => {
			sessionMap.delete(sessionName);
		});

		const page = context.pages()[0] ?? (await context.newPage());

		const session: BrowserSession = {
			context,
			page,
			sessionName,
			profile: sessionConfig.profile,
			profileDir,
			headed: false,
			createdAt: Date.now(),
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
		};
		if (browserConfig.type !== 'default' && browserConfig.path) {
			launchOptions.executablePath = browserConfig.path;
		}

		const context = await chromium.launchPersistentContext(profileDir, launchOptions);

		context.on('close', () => {
			sessionMap.delete(sessionName);
		});

		const page = context.pages()[0] ?? (await context.newPage());

		const session: BrowserSession = {
			context,
			page,
			sessionName,
			profile: sessionConfig.profile,
			profileDir,
			headed,
			createdAt: Date.now(),
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
