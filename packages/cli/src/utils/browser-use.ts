import {spawn, execSync} from 'node:child_process';

// Constants
const BINARY_NAME = 'browser-use';

// Blocked commands that cannot be run via browser_command
// Updated for browser-use CLI
const BLOCKED_COMMANDS = [
	'open',
	'close',
	'cookies',
	'storage',
	'network',
	'download',
	'run', // agent tasks
	'session', // session management
	'task', // task commands
	'tunnel', // tunneling
];

export interface CommandResult {
	stdout: string;
	stderr: string;
	code: number;
}

// ============ Installation ============

/**
 * Get the browser-use binary path (cross-platform)
 */
function getBrowserUsePath(): string | null {
	try {
		const command =
			process.platform === 'win32'
				? `where ${BINARY_NAME}`
				: `which ${BINARY_NAME}`;
		const result = execSync(command, {stdio: 'pipe', encoding: 'utf-8'});
		const path = result.trim().split('\n')[0]; // Take first result on Windows (where can return multiple)
		return path || null;
	} catch {
		return null;
	}
}

// Cache the binary path
let cachedBinaryPath: string | null | undefined;

function getBinaryPath(): string | null {
	if (cachedBinaryPath === undefined) {
		cachedBinaryPath = getBrowserUsePath();
	}
	return cachedBinaryPath;
}

// Clear cache (useful after installation)
export function clearBinaryPathCache(): void {
	cachedBinaryPath = undefined;
}

export async function isBrowserUseInstalled(): Promise<boolean> {
	return getBinaryPath() !== null;
}

/**
 * Install browser-use using the official installer
 */
export async function installBrowserUse(): Promise<CommandResult> {
	const isWindows = process.platform === 'win32';

	// Use the official browser-use installer
	const installCommand = isWindows
		? `& "C:\Program Files\Git\bin\bash.exe" -c 'curl -fsSL https://browser-use.com/cli/install.sh | bash -s -- --full'`
		: 'curl -fsSL https://browser-use.com/cli/install.sh | bash -s -- --full # All modes';

	const result = await runShellCommand(installCommand);

	// Clear cache so next check finds the newly installed binary
	clearBinaryPathCache();
	return result;
}

/**
 * Run browser-use doctor to validate installation
 */
export async function runBrowserUseDoctor(): Promise<CommandResult> {
	return runBrowserUseRawCommand(['doctor']);
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
 * Run a raw browser-use command without session
 */
async function runBrowserUseRawCommand(args: string[]): Promise<CommandResult> {
	const binaryPath = getBinaryPath();
	if (!binaryPath) {
		return {
			stdout: '',
			stderr: 'browser-use not found. Run: corebrain browser install',
			code: 1,
		};
	}

	return new Promise(resolve => {
		const proc = spawn(binaryPath, args, {
			stdio: ['pipe', 'pipe', 'pipe'],
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
 * Run a browser-use command with session
 * browser-use --session <name> <command> <args>
 */
async function runBrowserUseCommand(
	sessionName: string,
	args: string[],
): Promise<CommandResult> {
	// Use --session for persistent session state
	const fullArgs = ['--session', sessionName, ...args];
	return runBrowserUseRawCommand(fullArgs);
}

// ============ Session Management ============

export interface SessionInfo {
	name: string;
	status?: string;
}

/**
 * List all available sessions using browser-use sessions command
 */
export async function listSessions(): Promise<string[]> {
	const result = await runBrowserUseRawCommand(['sessions']);

	if (result.code !== 0) {
		return [];
	}

	// Parse output - each line is a session name
	// browser-use sessions outputs one session per line
	const sessions = result.stdout
		.trim()
		.split('\n')
		.map(line => line.trim())
		.filter(line => line.length > 0 && !line.startsWith('No '));

	return sessions;
}

/**
 * Check if a session exists
 */
export async function sessionExists(name: string): Promise<boolean> {
	const sessions = await listSessions();
	return sessions.includes(name);
}

// ============ Browser Operations ============

/**
 * Open a browser with URL using the specified session
 */
export async function browserOpen(
	url: string,
	sessionName: string = 'default',
	headed: boolean = false,
): Promise<CommandResult> {
	const args = headed ? ['--headed', 'open', url] : ['open', url];
	return runBrowserUseCommand(sessionName, args);
}

/**
 * Close a browser for the specified session
 */
export async function browserClose(
	sessionName: string,
): Promise<CommandResult> {
	return runBrowserUseCommand(sessionName, ['close']);
}

/**
 * Close all browser sessions
 */
export async function browserCloseAll(): Promise<CommandResult> {
	return runBrowserUseRawCommand(['close', '--all']);
}

/**
 * Check if a command is blocked
 */
export function isBlockedCommand(command: string): boolean {
	const cmd = command.toLowerCase().trim();
	return BLOCKED_COMMANDS.includes(cmd);
}

/**
 * Execute a generic browser command on a session
 * Blocks: open, close, cookies, storage, network, download, run, session, task, tunnel
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

	return runBrowserUseCommand(sessionName, [command, ...args]);
}

/**
 * Get all available sessions
 */
export async function browserGetSessions(): Promise<string[]> {
	return listSessions();
}

/**
 * Get server status
 */
export async function getServerStatus(): Promise<CommandResult> {
	return runBrowserUseRawCommand(['server', 'status']);
}
