import zod from 'zod';
import {spawn} from 'node:child_process';
import {existsSync} from 'node:fs';
import {getPreferences} from '@/config/preferences';
import {getConfigPath} from '@/config/paths';
import type {GatewayTool} from './browser-tools';
import type {ExecConfig} from '@/types/config';

// Default directory for exec commands - uses same directory as config
const DEFAULT_EXEC_DIR = getConfigPath();

// Default blocked command patterns — always enforced unless allowUnsafe is set
const DEFAULT_BLOCKED: {pattern: RegExp; reason: string}[] = [
	// Destructive file operations
	{pattern: /\brm\b/, reason: 'rm is blocked by default'},
	{pattern: /\bchmod\b/, reason: 'chmod is blocked by default'},
	{pattern: /\bchown\b/, reason: 'chown is blocked by default'},
	{pattern: /\bdd\b.*\bof=/, reason: 'dd with output is blocked by default'},
	{pattern: /\bmkfs\b/, reason: 'mkfs is blocked by default'},
	{pattern: /\bfdisk\b/, reason: 'fdisk is blocked by default'},
	{pattern: /\bparted\b/, reason: 'parted is blocked by default'},
	// Privilege escalation
	{pattern: /\bsudo\b/, reason: 'sudo is blocked by default'},
	{pattern: /\bsu\s/, reason: 'su is blocked by default'},
	{pattern: /\bpasswd\b/, reason: 'passwd is blocked by default'},
	// Network commands
	{pattern: /\bcurl\b/, reason: 'curl is blocked by default'},
	{pattern: /\bwget\b/, reason: 'wget is blocked by default'},
	{pattern: /\bssh\b/, reason: 'ssh is blocked by default'},
	{pattern: /\bscp\b/, reason: 'scp is blocked by default'},
	{pattern: /\brsync\b/, reason: 'rsync is blocked by default'},
	{pattern: /\bnc\b/, reason: 'nc (netcat) is blocked by default'},
	{pattern: /\bnetcat\b/, reason: 'netcat is blocked by default'},
	{pattern: /\bnmap\b/, reason: 'nmap is blocked by default'},
	{pattern: /\btelnet\b/, reason: 'telnet is blocked by default'},
	{pattern: /\bftp\b/, reason: 'ftp is blocked by default'},
	{pattern: /\bsftp\b/, reason: 'sftp is blocked by default'},
	// System commands
	{pattern: /\bshutdown\b/, reason: 'shutdown is blocked by default'},
	{pattern: /\breboot\b/, reason: 'reboot is blocked by default'},
	{pattern: /\bhalt\b/, reason: 'halt is blocked by default'},
	{pattern: /\bpoweroff\b/, reason: 'poweroff is blocked by default'},
	// Shell injection
	{pattern: /\|\s*(bash|sh|zsh|fish|ksh)\b/, reason: 'pipe to shell is blocked by default'},
	{pattern: /\beval\b/, reason: 'eval is blocked by default'},
];

// ============ Zod Schemas ============

export const ExecCommandSchema = zod.object({
	command: zod.string(),
	dir: zod.string().optional(),
	timeout: zod.number().optional(), // Timeout in ms
});

// ============ JSON Schemas ============

const jsonSchemas: Record<string, Record<string, unknown>> = {
	exec_command: {
		type: 'object',
		properties: {
			command: {
				type: 'string',
				description: 'The command to execute (e.g., "ls -la" or "git status")',
			},
			dir: {
				type: 'string',
				description: 'Working directory for the command (defaults to ~/.corebrain)',
			},
			timeout: {
				type: 'number',
				description: 'Timeout in milliseconds (default: 30000)',
			},
		},
		required: ['command'],
	},
};

// ============ Tool Definitions ============

export const execTools: GatewayTool[] = [
	{
		name: 'exec_command',
		description: 'Execute a shell command',
		inputSchema: jsonSchemas.exec_command!,
	},
];

// ============ Helper Functions ============

function getExecConfig(): ExecConfig {
	const prefs = getPreferences();
	// Use gateway slots config for exec allow/deny patterns
	const slotsExec = prefs.gateway?.slots?.exec;
	if (slotsExec) {
		return {
			allow: slotsExec.allow,
			deny: slotsExec.deny,
			allowUnsafe: slotsExec.allowUnsafe,
			defaultDir: prefs.exec?.defaultDir,
		};
	}
	return prefs.exec || {};
}

/**
 * Parse a Bash pattern like "Bash(npm run *)" and extract the glob pattern
 */
function parseBashPattern(pattern: string): string | null {
	const match = pattern.match(/^Bash\((.+)\)$/);
	return match ? match[1] : null;
}

/**
 * Convert a glob-like pattern to a regex
 * * matches any sequence of characters
 */
function globToRegex(glob: string): RegExp {
	// Escape regex special chars except *
	const escaped = glob.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
	// Replace * with .*
	const pattern = escaped.replace(/\*/g, '.*');
	return new RegExp(`^${pattern}$`);
}

/**
 * Check if a command matches a Bash pattern
 */
function matchesPattern(command: string, pattern: string): boolean {
	// Handle wildcard pattern
	if (pattern === '*' || pattern === 'Bash(*)') {
		return true;
	}

	const glob = parseBashPattern(pattern);
	if (!glob) {
		return false;
	}

	try {
		const regex = globToRegex(glob);
		return regex.test(command);
	} catch {
		return false;
	}
}

/**
 * Check if a command is allowed based on config patterns
 */
function isCommandAllowed(command: string): {allowed: boolean; reason?: string} {
	const config = getExecConfig();
	const allowPatterns = config.allow || [];
	const denyPatterns = config.deny || [];

	// Check default blocked patterns unless allowUnsafe is explicitly set
	if (!config.allowUnsafe) {
		for (const {pattern, reason} of DEFAULT_BLOCKED) {
			if (pattern.test(command)) {
				return {allowed: false, reason};
			}
		}
	}

	// Check user-configured deny patterns (takes precedence over allow)
	for (const pattern of denyPatterns) {
		if (matchesPattern(command, pattern)) {
			return {allowed: false, reason: `Command matches deny pattern: ${pattern}`};
		}
	}

	// If no allow patterns configured, allow by default (unless denied above)
	if (allowPatterns.length === 0) {
		return {allowed: true};
	}

	// Check if matches any allow pattern
	const isAllowed = allowPatterns.some((pattern) => matchesPattern(command, pattern));
	if (!isAllowed) {
		return {allowed: false, reason: 'Command not in allow list'};
	}

	return {allowed: true};
}

/**
 * Execute a command and return output
 */
async function executeCommand(
	command: string,
	dir: string,
	timeout: number,
): Promise<{stdout: string; stderr: string; code: number}> {
	return new Promise((resolve) => {
		const proc = spawn(command, {
			cwd: dir,
			shell: true,
			stdio: ['pipe', 'pipe', 'pipe'],
		});

		let stdout = '';
		let stderr = '';
		let killed = false;

		// Set timeout
		const timer = setTimeout(() => {
			killed = true;
			proc.kill('SIGTERM');
		}, timeout);

		proc.stdout?.on('data', (data) => {
			stdout += data.toString();
		});

		proc.stderr?.on('data', (data) => {
			stderr += data.toString();
		});

		proc.on('close', (code) => {
			clearTimeout(timer);
			if (killed) {
				resolve({stdout, stderr: stderr + '\nCommand timed out', code: 124});
			} else {
				resolve({stdout, stderr, code: code || 0});
			}
		});

		proc.on('error', (err) => {
			clearTimeout(timer);
			resolve({stdout, stderr: err.message, code: 1});
		});
	});
}

// ============ Tool Handlers ============

async function handleExecCommand(params: zod.infer<typeof ExecCommandSchema>) {
	const config = getExecConfig();

	// Check if command is allowed
	const {allowed, reason} = isCommandAllowed(params.command);
	if (!allowed) {
		return {
			success: false,
			error: `Command not allowed: ${reason}`,
		};
	}

	// Determine working directory
	const dir = params.dir || config.defaultDir || DEFAULT_EXEC_DIR;

	// Ensure directory exists
	if (!existsSync(dir)) {
		return {
			success: false,
			error: `Directory "${dir}" does not exist`,
		};
	}

	// Execute command
	const timeout = params.timeout || 30000;
	const result = await executeCommand(params.command, dir, timeout);

	return {
		success: result.code === 0,
		result: {
			command: params.command,
			dir,
			exitCode: result.code,
			stdout: result.stdout,
			stderr: result.stderr || undefined,
		},
	};
}

// ============ Tool Execution ============

export async function executeExecTool(
	toolName: string,
	params: Record<string, unknown>,
): Promise<{success: boolean; result?: unknown; error?: string}> {
	try {
		switch (toolName) {
			case 'exec_command':
				return await handleExecCommand(ExecCommandSchema.parse(params));

			default:
				return {success: false, error: `Unknown tool: ${toolName}`};
		}
	} catch (err) {
		if (err instanceof zod.ZodError) {
			return {success: false, error: `Invalid parameters: ${err.message}`};
		}
		return {
			success: false,
			error: err instanceof Error ? err.message : 'Unknown error',
		};
	}
}
