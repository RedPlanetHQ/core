import {spawn, execSync} from 'node:child_process';
import {
	existsSync,
	mkdirSync,
	rmSync,
	readdirSync,
	readFileSync,
	writeFileSync,
} from 'node:fs';
import {join} from 'node:path';
import {getConfigPath} from '@/config/paths';

// Constants - use unified config directory
const COREBRAIN_DIR = getConfigPath();
const BROWSER_PROFILES_DIR = join(COREBRAIN_DIR, 'browser-profiles');
const SESSIONS_FILE = join(COREBRAIN_DIR, 'browser-sessions.json');
const MAX_SESSIONS = 3;

// Blocked commands that cannot be run via browser_command
const BLOCKED_COMMANDS = [
	'open',
	'close',
	'cookies',
	'storage',
	'network',
	'trace',
	'highlight',
	'console',
	'errors',
	'state',
	'download',
];

export interface CommandResult {
	stdout: string;
	stderr: string;
	code: number;
}

export interface BrowserSession {
	sessionName: string;
	profile: string;
	url: string;
	startedAt: string;
}

// ============ Session Management ============

function loadSessions(): BrowserSession[] {
	try {
		if (!existsSync(SESSIONS_FILE)) {
			return [];
		}
		const data = readFileSync(SESSIONS_FILE, 'utf-8');
		return JSON.parse(data);
	} catch {
		return [];
	}
}

function saveSessions(sessions: BrowserSession[]): void {
	if (!existsSync(COREBRAIN_DIR)) {
		mkdirSync(COREBRAIN_DIR, {recursive: true});
	}
	writeFileSync(SESSIONS_FILE, JSON.stringify(sessions, null, 2));
}

export function getActiveSessions(): BrowserSession[] {
	return loadSessions();
}

export function getSession(sessionName: string): BrowserSession | undefined {
	const sessions = loadSessions();
	return sessions.find(s => s.sessionName === sessionName);
}

function addSession(session: BrowserSession): void {
	const sessions = loadSessions();
	// Remove existing session with same name if any
	const filtered = sessions.filter(s => s.sessionName !== session.sessionName);
	filtered.push(session);
	saveSessions(filtered);
}

function removeSession(sessionName: string): void {
	const sessions = loadSessions();
	const filtered = sessions.filter(s => s.sessionName !== sessionName);
	saveSessions(filtered);
}

export function canCreateSession(): {allowed: boolean; count: number} {
	const sessions = loadSessions();
	return {
		allowed: sessions.length < MAX_SESSIONS,
		count: sessions.length,
	};
}

// ============ Installation ============

export async function isAgentBrowserInstalled(): Promise<boolean> {
	try {
		execSync('which agent-browser', {stdio: 'pipe'});
		return true;
	} catch {
		return false;
	}
}

export async function installAgentBrowser(): Promise<CommandResult> {
	return runNpmCommand(['install', '-g', 'agent-browser']);
}

function runNpmCommand(args: string[]): Promise<CommandResult> {
	return new Promise(resolve => {
		const proc = spawn('npm', args, {
			stdio: ['pipe', 'pipe', 'pipe'],
			shell: true,
		});

		let stdout = '';
		let stderr = '';

		proc.stdout?.on('data', data => {
			stdout += data.toString();
		});

		proc.stderr?.on('data', data => {
			stderr += data.toString();
		});

		proc.on('close', code => {
			resolve({stdout, stderr, code: code ?? 0});
		});

		proc.on('error', err => {
			resolve({stdout, stderr: err.message, code: 1});
		});
	});
}

// ============ Core Browser Command Runner ============

async function runAgentBrowserCommand(
	sessionName: string,
	args: string[],
): Promise<CommandResult> {
	return new Promise(resolve => {
		const fullArgs = [...args, '--session', sessionName];
		const proc = spawn(
			'/Users/harshithmullapudi/.nvm/versions/node/v20.18.3/lib/node_modules/agent-browser/bin/agent-browser-darwin-arm64',
			fullArgs,
			{
				cwd: COREBRAIN_DIR,
				stdio: ['pipe', 'pipe', 'pipe'],
			},
		);

		let stdout = '';
		let stderr = '';

		proc.stdout?.on('data', data => {
			stdout += data.toString();
		});

		proc.stderr?.on('data', data => {
			stderr += data.toString();
		});

		proc.on('close', code => {
			resolve({stdout, stderr, code: code ?? 0});
		});

		proc.on('error', err => {
			resolve({stdout, stderr: err.message, code: 1});
		});
	});
}

// ============ Profile Management ============

function ensureProfileExists(profile: string): string {
	const profilePath = join(BROWSER_PROFILES_DIR, profile);

	if (!existsSync(profilePath)) {
		mkdirSync(profilePath, {recursive: true});
	}

	return profilePath;
}

export function createProfile(name: string): {
	success: boolean;
	path: string;
	error?: string;
} {
	const profilePath = join(BROWSER_PROFILES_DIR, name);

	try {
		if (existsSync(profilePath)) {
			return {
				success: false,
				path: profilePath,
				error: 'Profile already exists',
			};
		}

		mkdirSync(profilePath, {recursive: true});
		return {success: true, path: profilePath};
	} catch (err) {
		return {
			success: false,
			path: profilePath,
			error: err instanceof Error ? err.message : 'Failed to create profile',
		};
	}
}

export function deleteProfile(name: string): {
	success: boolean;
	error?: string;
} {
	const profilePath = join(BROWSER_PROFILES_DIR, name);

	try {
		if (!existsSync(profilePath)) {
			return {success: false, error: 'Profile does not exist'};
		}

		rmSync(profilePath, {recursive: true, force: true});
		return {success: true};
	} catch (err) {
		return {
			success: false,
			error: err instanceof Error ? err.message : 'Failed to delete profile',
		};
	}
}

export function listProfiles(): string[] {
	try {
		if (!existsSync(BROWSER_PROFILES_DIR)) {
			return [];
		}

		return readdirSync(BROWSER_PROFILES_DIR, {withFileTypes: true})
			.filter(entry => entry.isDirectory())
			.map(entry => entry.name);
	} catch {
		return [];
	}
}

export function getProfilesDir(): string {
	return BROWSER_PROFILES_DIR;
}

// ============ Simplified Browser Tools ============

/**
 * Open a browser session with URL
 * Creates the corebrain profile if it doesn't exist
 * Enforces max 3 concurrent sessions
 */
export async function browserOpen(
	sessionName: string,
	url: string,
	profile: string = 'corebrain',
): Promise<CommandResult> {
	// Check session limit
	const {allowed, count} = canCreateSession();
	const existingSession = getSession(sessionName);

	// Allow if session already exists (re-opening) or under limit
	if (!existingSession && !allowed) {
		return {
			stdout: '',
			stderr: `Maximum ${MAX_SESSIONS} sessions allowed. Currently running: ${count}. Close a session first.`,
			code: 1,
		};
	}

	// Ensure profile directory exists
	const profilePath = ensureProfileExists(profile);

	const args = ['open', url, '--profile', profilePath];
	const result = await runAgentBrowserCommand(sessionName, args);

	if (result.code === 0) {
		addSession({
			sessionName,
			profile,
			url,
			startedAt: new Date().toISOString(),
		});
	}

	return result;
}

/**
 * Close a browser session
 */
export async function browserClose(
	sessionName: string,
): Promise<CommandResult> {
	const result = await runAgentBrowserCommand(sessionName, ['close']);

	// Remove session regardless of result (it might already be closed)
	removeSession(sessionName);

	return result;
}

/**
 * Check if a command is blocked
 */
export function isBlockedCommand(command: string): boolean {
	const cmd = command.toLowerCase().trim();
	return BLOCKED_COMMANDS.includes(cmd);
}

/**
 * Execute a generic browser command
 * Blocks: open, close, cookies, storage, network, trace, highlight, console, errors, state, download
 */
export async function browserCommand(
	sessionName: string,
	command: string,
	args: string[] = [],
): Promise<CommandResult> {
	// Check if command is blocked
	if (isBlockedCommand(command)) {
		return {
			stdout: '',
			stderr: `Command "${command}" is blocked. Blocked commands: ${BLOCKED_COMMANDS.join(
				', ',
			)}`,
			code: 1,
		};
	}

	// Check if session exists
	const session = getSession(sessionName);
	if (!session) {
		return {
			stdout: '',
			stderr: `Session "${sessionName}" not found. Use browser_open to create a session first.`,
			code: 1,
		};
	}

	return runAgentBrowserCommand(sessionName, [command, ...args]);
}

/**
 * List all active browser sessions
 */
export function browserListSessions(): BrowserSession[] {
	return getActiveSessions();
}

/**
 * Get all available profiles
 */
export function browserGetProfiles(): string[] {
	return listProfiles();
}

/**
 * Close all active browser sessions
 */
export async function browserCloseAll(): Promise<void> {
	const sessions = loadSessions();
	for (const session of sessions) {
		try {
			await browserClose(session.sessionName);
		} catch {
			// Ignore errors when closing individual sessions
		}
	}
	// Clear all sessions
	saveSessions([]);
}

// ============ Session Status ============

export async function getSessionStatus(
	sessionName: string,
): Promise<'running' | 'stopped' | 'unknown'> {
	const result = await runAgentBrowserCommand(sessionName, ['status']);

	if (result.code !== 0) {
		return 'unknown';
	}

	const output = result.stdout.toLowerCase();
	if (output.includes('running') || output.includes('active')) {
		return 'running';
	}

	return 'stopped';
}
