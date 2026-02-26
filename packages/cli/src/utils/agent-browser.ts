import {spawn, execSync} from 'node:child_process';
import fs from 'node:fs';
import {getPreferences, updatePreferences} from '@/config/preferences';
import type {BrowserType} from '@/types/config';

// Constants
const BINARY_NAME = 'agent-browser';
const MAX_SESSIONS = 5;
const DEFAULT_SESSIONS = ['personal', 'work', 'misc'];

// ============ Browser Executable Paths ============

// Known browser paths for auto-detection
const BRAVE_PATHS: Record<string, string[]> = {
	darwin: ['/Applications/Brave Browser.app/Contents/MacOS/Brave Browser'],
	linux: ['/usr/bin/brave-browser', '/usr/bin/brave', '/snap/bin/brave'],
	win32: [
		'C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe',
		'C:\\Program Files (x86)\\BraveSoftware\\Brave-Browser\\Application\\brave.exe',
	],
};

const CHROME_PATHS: Record<string, string[]> = {
	darwin: ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'],
	linux: ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable'],
	win32: [
		'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
		'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
	],
};

export type {BrowserType} from '@/types/config';

// ============ Browser Config Management (stored in preferences.browser) ============

/**
 * Get all configured session names from preferences
 */
export function getConfiguredSessions(): string[] {
	const prefs = getPreferences();
	return prefs.browser?.sessions || [];
}

/**
 * Check if a session name is configured
 */
export function isSessionConfigured(name: string): boolean {
	const sessions = getConfiguredSessions();
	return sessions.includes(name);
}

/**
 * Create a new session (add to preferences.browser.sessions)
 */
export function createSession(name: string): {
	success: boolean;
	error?: string;
} {
	// Validate name
	if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
		return {
			success: false,
			error:
				'Session name must contain only alphanumeric characters, hyphens, and underscores',
		};
	}

	const prefs = getPreferences();
	const currentSessions = prefs.browser?.sessions || [];

	if (currentSessions.includes(name)) {
		return {success: false, error: `Session "${name}" already exists`};
	}

	if (currentSessions.length >= MAX_SESSIONS) {
		return {
			success: false,
			error: `Maximum ${MAX_SESSIONS} sessions allowed. Current: ${currentSessions.join(
				', ',
			)}`,
		};
	}

	updatePreferences({
		browser: {
			...prefs.browser,
			sessions: [...currentSessions, name],
		},
	});

	return {success: true};
}

/**
 * Delete a session from preferences
 */
export function deleteSession(name: string): {
	success: boolean;
	error?: string;
} {
	const prefs = getPreferences();
	const currentSessions = prefs.browser?.sessions || [];

	if (!currentSessions.includes(name)) {
		return {success: false, error: `Session "${name}" does not exist`};
	}

	updatePreferences({
		browser: {
			...prefs.browser,
			sessions: currentSessions.filter(s => s !== name),
		},
	});

	return {success: true};
}

/**
 * Initialize default sessions (called on install)
 */
export function initializeDefaultSessions(): void {
	const prefs = getPreferences();
	const currentSessions = prefs.browser?.sessions || [];

	// Only add defaults if no sessions exist
	if (currentSessions.length === 0) {
		updatePreferences({
			browser: {
				...prefs.browser,
				sessions: [...DEFAULT_SESSIONS],
			},
		});
	}
}

// ============ Browser Executable Management ============

/**
 * Auto-detect Brave browser path
 */
export function detectBravePath(): string | null {
	const platform = process.platform as 'darwin' | 'linux' | 'win32';
	const paths = BRAVE_PATHS[platform] || [];

	for (const p of paths) {
		if (fs.existsSync(p)) {
			return p;
		}
	}
	return null;
}

/**
 * Auto-detect Chrome browser path
 */
export function detectChromePath(): string | null {
	const platform = process.platform as 'darwin' | 'linux' | 'win32';
	const paths = CHROME_PATHS[platform] || [];

	for (const p of paths) {
		if (fs.existsSync(p)) {
			return p;
		}
	}
	return null;
}

/**
 * Detect all available browsers
 */
export function detectAvailableBrowsers(): {type: BrowserType; path: string}[] {
	const browsers: {type: BrowserType; path: string}[] = [];

	const bravePath = detectBravePath();
	if (bravePath) {
		browsers.push({type: 'brave', path: bravePath});
	}

	const chromePath = detectChromePath();
	if (chromePath) {
		browsers.push({type: 'chrome', path: chromePath});
	}

	return browsers;
}

/**
 * Get configured browser executable from preferences.browser
 */
export function getBrowserExecutable(): {type: BrowserType; path?: string} {
	const prefs = getPreferences();
	return {
		type: prefs.browser?.browserType || 'default',
		path: prefs.browser?.browserExecutable,
	};
}

/**
 * Set browser executable in preferences.browser
 */
export function setBrowserExecutable(
	type: BrowserType,
	customPath?: string,
): {success: boolean; error?: string} {
	const prefs = getPreferences();
	let browserExecutable: string | undefined;

	if (type === 'default') {
		// No executable path for default
		browserExecutable = undefined;
	} else if (type === 'brave') {
		const bravePath = detectBravePath();
		if (!bravePath) {
			return {
				success: false,
				error: 'Brave browser not found. Install it or use custom path.',
			};
		}
		browserExecutable = bravePath;
	} else if (type === 'chrome') {
		const chromePath = detectChromePath();
		if (!chromePath) {
			return {
				success: false,
				error: 'Chrome browser not found. Install it or use custom path.',
			};
		}
		browserExecutable = chromePath;
	} else if (type === 'custom') {
		if (!customPath) {
			return {success: false, error: 'Custom path is required'};
		}
		if (!fs.existsSync(customPath)) {
			return {success: false, error: `Browser not found at: ${customPath}`};
		}
		browserExecutable = customPath;
	}

	updatePreferences({
		browser: {
			...prefs.browser,
			browserType: type,
			browserExecutable,
		},
	});

	return {success: true};
}

// Blocked commands that cannot be run via browser_command
const BLOCKED_COMMANDS = [
	'open',
	'close',
	'cookies',
	'storage',
	'network',
	'download',
	'run',
	'session',
	'task',
	'tunnel',
	'state',
];

export interface CommandResult {
	stdout: string;
	stderr: string;
	code: number;
}

// ============ Installation ============

/**
 * Get the agent-browser binary path (cross-platform)
 */
function getAgentBrowserPath(): string | null {
	try {
		const command =
			process.platform === 'win32'
				? `where ${BINARY_NAME}`
				: `which ${BINARY_NAME}`;
		const result = execSync(command, {stdio: 'pipe', encoding: 'utf-8'});
		const binaryPath = result.trim().split('\n')[0]; // Take first result on Windows (where can return multiple)
		return binaryPath || null;
	} catch {
		return null;
	}
}

// Cache the binary path
let cachedBinaryPath: string | null | undefined;

function getBinaryPath(): string | null {
	if (cachedBinaryPath === undefined) {
		cachedBinaryPath = getAgentBrowserPath();
	}
	return cachedBinaryPath;
}

// Clear cache (useful after installation)
export function clearBinaryPathCache(): void {
	cachedBinaryPath = undefined;
}

export async function isAgentBrowserInstalled(): Promise<boolean> {
	return getBinaryPath() !== null;
}

/**
 * Install agent-browser via npm
 */
export async function installAgentBrowser(): Promise<CommandResult> {
	const result = await runShellCommand('npm install -g agent-browser');

	// Clear cache so next check finds the newly installed binary
	clearBinaryPathCache();

	if (result.code === 0) {
		// Initialize default sessions after successful installation
		initializeDefaultSessions();
	}

	return result;
}

/**
 * Run agent-browser doctor to validate installation
 */
export async function runAgentBrowserDoctor(): Promise<CommandResult> {
	// agent-browser doesn't have a doctor command, so check version instead
	return runAgentBrowserRawCommand(['--version']);
}

function runShellCommand(command: string): Promise<CommandResult> {
	return new Promise(resolve => {
		const proc = spawn(command, [], {
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

/**
 * Run a raw agent-browser command without session
 */
async function runAgentBrowserRawCommand(
	args: string[],
): Promise<CommandResult> {
	const binaryPath = getBinaryPath();
	if (!binaryPath) {
		return {
			stdout: '',
			stderr: 'agent-browser not found. Run: corebrain browser install',
			code: 1,
		};
	}

	return new Promise(resolve => {
		const proc = spawn(binaryPath, args, {
			stdio: ['pipe', 'pipe', 'pipe'],
			env: process.env,
			detached: false,
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

/**
 * Run an agent-browser command with session
 * agent-browser [--executable-path <path>] --session <name> --session-name <name> [--headed] <command> <args>
 */
async function runAgentBrowserCommand(
	sessionName: string,
	args: string[],
	headed: boolean = false,
): Promise<CommandResult> {
	const fullArgs: string[] = [];

	// Add executable path if configured (not default)
	const browserConfig = getBrowserExecutable();
	if (browserConfig.type !== 'default' && browserConfig.path) {
		fullArgs.push('--executable-path', browserConfig.path);
	}

	// Use both --session and --session-name with the same value
	fullArgs.push('--session', sessionName, '--session-name', sessionName);

	// --headed right before command
	if (headed) {
		fullArgs.push('--headed');
	}

	fullArgs.push(...args);

	const result = await runAgentBrowserRawCommand(fullArgs);

	return result;
}

// ============ Session Management ============

export interface SessionInfo {
	name: string;
	status?: string;
}

/**
 * List all available sessions using agent-browser session list command
 */
export async function listSessions(): Promise<string[]> {
	const result = await runAgentBrowserRawCommand(['session', 'list']);

	if (result.code !== 0) {
		return [];
	}

	// Parse output - each line after "Active sessions:" is a session name
	// Lines starting with "->" or just session names
	const lines = result.stdout.trim().split('\n');
	const sessions: string[] = [];

	for (const line of lines) {
		const trimmed = line.trim();
		// Skip header lines
		if (trimmed.startsWith('Active sessions:') || trimmed.length === 0) {
			continue;
		}
		// Handle "-> default" or "   agent1" formats
		const sessionName = trimmed.replace(/^->\s*/, '').trim();
		if (sessionName && !sessionName.startsWith('No ')) {
			sessions.push(sessionName);
		}
	}

	return sessions;
}

/**
 * Check if a session exists
 */
export async function sessionExists(name: string): Promise<boolean> {
	const sessions = await listSessions();
	return sessions.includes(name);
}

/**
 * Check if max sessions limit is reached
 */
export async function isSessionLimitReached(): Promise<boolean> {
	const sessions = await listSessions();
	return sessions.length >= MAX_SESSIONS;
}

/**
 * Get current session count
 */
export async function getSessionCount(): Promise<number> {
	const sessions = await listSessions();
	return sessions.length;
}

// ============ Browser Operations ============

/**
 * Open a browser with URL using the specified session
 */
export async function browserOpen(
	url: string,
	sessionName: string = 'corebrain',
	headed: boolean = false,
): Promise<CommandResult> {
	// Validate session is configured
	if (!isSessionConfigured(sessionName)) {
		const configured = getConfiguredSessions();
		if (configured.length === 0) {
			return {
				stdout: '',
				stderr: `No sessions configured. Run: corebrain browser create-session <name>`,
				code: 1,
			};
		}
		return {
			stdout: '',
			stderr: `Session "${sessionName}" is not configured. Available sessions: ${configured.join(
				', ',
			)}. Create with: corebrain browser create-session <name>`,
			code: 1,
		};
	}

	return runAgentBrowserCommand(sessionName, ['open', url], headed);
}

/**
 * Close a browser for the specified session
 */
export async function browserClose(
	sessionName: string,
): Promise<CommandResult> {
	// Validate session is configured
	if (!isSessionConfigured(sessionName)) {
		const configured = getConfiguredSessions();
		return {
			stdout: '',
			stderr: `Session "${sessionName}" is not configured. Available sessions: ${configured.join(
				', ',
			)}`,
			code: 1,
		};
	}

	// Use close --session <name> format
	return runAgentBrowserRawCommand(['close', '--session', sessionName]);
}

/**
 * Close all browser sessions by closing each configured session
 */
export async function browserCloseAll(): Promise<CommandResult> {
	// Get all configured sessions and close each
	const configuredSessions = getConfiguredSessions();

	if (configuredSessions.length === 0) {
		return {
			stdout: 'No sessions configured',
			stderr: '',
			code: 0,
		};
	}

	const results: string[] = [];
	let hasError = false;

	// Close each configured session
	for (const session of configuredSessions) {
		const result = await runAgentBrowserRawCommand([
			'close',
			'--session',
			session,
		]);
		if (result.code !== 0 && !result.stderr.includes('not running')) {
			hasError = true;
			results.push(`Failed to close ${session}: ${result.stderr}`);
		} else {
			results.push(`Closed session: ${session}`);
		}
	}

	return {
		stdout: results.join('\n'),
		stderr: hasError ? 'Some sessions failed to close' : '',
		code: hasError ? 1 : 0,
	};
}

/**
 * Check if a command is blocked
 */
export function isBlockedCommand(command: string): boolean {
	const cmd = command.toLowerCase().trim();
	return BLOCKED_COMMANDS.includes(cmd);
}

// Args that are controlled internally and should be stripped from user input
const INTERNAL_ARGS = ['--session', '--session-name', '--executable-path'];

/**
 * Filter out internal args that we control (session, session-name, executable-path)
 */
function filterInternalArgs(args: string[]): string[] {
	const filtered: string[] = [];
	let skipNext = false;

	for (let i = 0; i < args.length; i++) {
		if (skipNext) {
			skipNext = false;
			continue;
		}

		const arg = args[i];

		// Check if this arg is an internal arg we should filter
		const isInternal = INTERNAL_ARGS.some(
			internal => arg === internal || arg.startsWith(`${internal}=`),
		);

		if (isInternal) {
			// If it's --flag value format (not --flag=value), skip the next arg too
			if (!arg.includes('=')) {
				skipNext = true;
			}
			continue;
		}

		filtered.push(arg);
	}

	return filtered;
}

/**
 * Execute a generic browser command on a session
 * Blocks: open, close, cookies, storage, network, download, run, session, task, tunnel, state
 * Filters: --session, --session-name, --executable-path (controlled internally)
 */
export async function browserCommand(
	sessionName: string,
	command: string,
	args: string[] = [],
): Promise<CommandResult> {
	// Validate session is configured
	if (!isSessionConfigured(sessionName)) {
		const configured = getConfiguredSessions();
		return {
			stdout: '',
			stderr: `Session "${sessionName}" is not configured. Available sessions: ${configured.join(
				', ',
			)}`,
			code: 1,
		};
	}

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

	// Filter out internal args that could override our session/executable settings
	const filteredArgs = filterInternalArgs(args);

	return runAgentBrowserCommand(sessionName, [command, ...filteredArgs]);
}

/**
 * Get all configured sessions (sync)
 */
export function browserGetSessions(): string[] {
	return getConfiguredSessions();
}

/**
 * Get running sessions from agent-browser
 */
export async function getActiveSessions(): Promise<string[]> {
	return listSessions();
}

/**
 * Get server status
 */
export async function getServerStatus(): Promise<CommandResult> {
	return runAgentBrowserRawCommand(['session', 'list']);
}

/**
 * Get max sessions limit
 */
export function getMaxSessions(): number {
	return MAX_SESSIONS;
}

/**
 * Get default sessions list
 */
export function getDefaultSessions(): string[] {
	return DEFAULT_SESSIONS;
}
