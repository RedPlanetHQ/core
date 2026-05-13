import zod from 'zod';
import {spawn} from 'node:child_process';
import {existsSync} from 'node:fs';
import {getPreferences} from '@/config/preferences';
import {getConfigPath} from '@/config/paths';
import type {GatewayTool} from './browser-tools';
import type {ExecConfig} from '@/types/config';
import {listFolders, resolveFolderForPath} from '@/config/folders';
import {folderScopeError} from './scope-error';

// Default directory for exec commands - uses same directory as config
const DEFAULT_EXEC_DIR = getConfigPath();

// Defaults for stdout/stderr capture caps. Unbounded accumulation has caused
// OOMs upstream when commands like `cat huge.log` or `sed -n '1,99999p'` ran
// through the gateway — the captured strings flow into the agent's message
// history and pin megabytes in the webapp heap for the rest of the session.
const DEFAULT_MAX_STDOUT_BYTES = 128 * 1024; // 128 KB
const DEFAULT_MAX_STDERR_BYTES = 16 * 1024; // 16 KB
// Hard ceiling on bytes we will *read* off the child's pipes before killing
// the process. Acts as a backstop against `yes`/runaway producers — we keep
// `kill = max * KILL_MULTIPLIER` so legitimate spikes still finish.
const KILL_MULTIPLIER = 8;

function formatBytes(n: number): string {
	if (n < 1024) return `${n} B`;
	if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
	return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Capture child-process stream output without retaining more than `maxBytes`.
 * Keeps the head (~30%) and a sliding tail (~70%), dropping the middle. The
 * tail bias matters: for shell commands the trailing bytes (exit error,
 * final summary) are usually the most useful slice for the model.
 */
class StreamCapture {
	private head: Buffer[] = [];
	private headBytes = 0;
	private tail: Buffer[] = [];
	private tailBytes = 0;
	totalBytes = 0;

	private readonly headCap: number;
	private readonly tailCap: number;

	constructor(public readonly maxBytes: number) {
		this.headCap = Math.floor(maxBytes * 0.3);
		this.tailCap = maxBytes - this.headCap;
	}

	push(chunk: Buffer): void {
		this.totalBytes += chunk.length;
		if (this.headBytes < this.headCap) {
			const room = this.headCap - this.headBytes;
			if (chunk.length <= room) {
				this.head.push(chunk);
				this.headBytes += chunk.length;
				return;
			}
			this.head.push(chunk.subarray(0, room));
			this.headBytes += room;
			this.pushTail(chunk.subarray(room));
			return;
		}
		this.pushTail(chunk);
	}

	private pushTail(chunk: Buffer): void {
		this.tail.push(chunk);
		this.tailBytes += chunk.length;
		while (this.tailBytes > this.tailCap && this.tail.length > 0) {
			const first = this.tail[0]!;
			const excess = this.tailBytes - this.tailCap;
			if (excess >= first.length) {
				this.tail.shift();
				this.tailBytes -= first.length;
			} else {
				this.tail[0] = first.subarray(excess);
				this.tailBytes -= excess;
			}
		}
	}

	finalize(label: string): {
		content: string;
		truncated: boolean;
		totalBytes: number;
		emittedBytes: number;
	} {
		const headStr = Buffer.concat(this.head).toString('utf8');
		if (this.tail.length === 0) {
			return {
				content: headStr,
				truncated: false,
				totalBytes: this.totalBytes,
				emittedBytes: this.headBytes,
			};
		}
		const tailStr = Buffer.concat(this.tail).toString('utf8');
		const emitted = this.headBytes + this.tailBytes;
		const dropped = this.totalBytes - emitted;
		if (dropped <= 0) {
			// Filled head + tail exactly, nothing actually dropped yet.
			return {
				content: headStr + tailStr,
				truncated: false,
				totalBytes: this.totalBytes,
				emittedBytes: emitted,
			};
		}
		const marker =
			`\n... [${label} truncated: ${formatBytes(dropped)} omitted, ` +
			`${formatBytes(this.totalBytes)} total. Re-run with head/tail/grep/sed -n 'A,Bp' ` +
			`or redirect to a file and read a slice — the full output exceeds the ${formatBytes(this.maxBytes)} cap.] ...\n`;
		return {
			content: headStr + marker + tailStr,
			truncated: true,
			totalBytes: this.totalBytes,
			emittedBytes: emitted,
		};
	}
}

// Warn once per process about the folders-empty fallback
let warnedFoldersEmpty = false;

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
				description:
					'Working directory. Must resolve to a folder registered via `corebrain folder add` with the `exec` scope. If no folders are registered, falls back to ExecConfig.defaultDir (deprecated).',
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

interface ExecuteResult {
	stdout: string;
	stderr: string;
	code: number;
	stdoutTruncated: boolean;
	stderrTruncated: boolean;
	stdoutTotalBytes: number;
	stderrTotalBytes: number;
	killedForOversize: boolean;
}

/**
 * Execute a command and return output, capping captured stdout/stderr so we
 * never accumulate arbitrary amounts of data in memory. If a stream blows
 * past `KILL_MULTIPLIER × cap` while we're already discarding bytes, we kill
 * the process — at that point we're throwing the data away anyway and the
 * producer is just keeping the pipe pressurized.
 */
async function executeCommand(
	command: string,
	dir: string,
	timeout: number,
	maxStdoutBytes: number,
	maxStderrBytes: number,
): Promise<ExecuteResult> {
	return new Promise((resolve) => {
		const proc = spawn(command, {
			cwd: dir,
			shell: true,
			stdio: ['pipe', 'pipe', 'pipe'],
		});

		const stdoutCap = new StreamCapture(maxStdoutBytes);
		const stderrCap = new StreamCapture(maxStderrBytes);
		let killed = false;
		let killedForOversize = false;
		const stdoutKillAt = maxStdoutBytes * KILL_MULTIPLIER;
		const stderrKillAt = maxStderrBytes * KILL_MULTIPLIER;

		// Set timeout
		const timer = setTimeout(() => {
			killed = true;
			proc.kill('SIGTERM');
		}, timeout);

		proc.stdout?.on('data', (data: Buffer) => {
			stdoutCap.push(data);
			if (!killed && stdoutCap.totalBytes > stdoutKillAt) {
				killed = true;
				killedForOversize = true;
				proc.kill('SIGTERM');
			}
		});

		proc.stderr?.on('data', (data: Buffer) => {
			stderrCap.push(data);
			if (!killed && stderrCap.totalBytes > stderrKillAt) {
				killed = true;
				killedForOversize = true;
				proc.kill('SIGTERM');
			}
		});

		const finish = (code: number, errMessage?: string) => {
			clearTimeout(timer);
			const stdoutFinal = stdoutCap.finalize('stdout');
			const stderrFinal = stderrCap.finalize('stderr');
			let stderr = stderrFinal.content;
			if (errMessage) {
				stderr = stderr ? `${stderr}\n${errMessage}` : errMessage;
			}
			if (killedForOversize) {
				const note =
					`\nCommand was terminated because its output exceeded ` +
					`${formatBytes(stdoutKillAt)} (stdout) / ${formatBytes(stderrKillAt)} (stderr). ` +
					`Re-run with a narrower selection (head/tail/grep/sed).`;
				stderr = stderr ? `${stderr}${note}` : note.trimStart();
			} else if (killed) {
				stderr = stderr ? `${stderr}\nCommand timed out` : 'Command timed out';
			}
			resolve({
				stdout: stdoutFinal.content,
				stderr,
				code,
				stdoutTruncated: stdoutFinal.truncated,
				stderrTruncated: stderrFinal.truncated,
				stdoutTotalBytes: stdoutFinal.totalBytes,
				stderrTotalBytes: stderrFinal.totalBytes,
				killedForOversize,
			});
		};

		proc.on('close', (code) => {
			if (killedForOversize) {
				finish(137);
			} else if (killed) {
				finish(124);
			} else {
				finish(code ?? 0);
			}
		});

		proc.on('error', (err) => {
			finish(1, err.message);
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

	// Determine working directory with scope enforcement
	let dir: string;
	const folders = listFolders();

	if (folders.length > 0) {
		// Scope enforcement: dir must resolve to a folder with `exec` scope
		const target = params.dir || process.cwd();
		const resolved = resolveFolderForPath(target, 'exec');
		if (!resolved) {
			const err = folderScopeError(target, 'exec');
			return {
				success: false,
				error: `${err.error.code}: ${err.error.message}`,
			};
		}
		dir = resolved.absPath;
	} else {
		// Backwards-compatibility fallback — no folders registered
		dir = params.dir || config.defaultDir || DEFAULT_EXEC_DIR;
		if (!warnedFoldersEmpty) {
			warnedFoldersEmpty = true;
			console.warn(
				'[corebrain] DEPRECATION: no folders registered; falling back to ExecConfig.defaultDir. ' +
					'Register folders with `corebrain folder add <path> --scopes exec` to enforce path scope.',
			);
		}
	}

	// Ensure directory exists
	if (!existsSync(dir)) {
		return {
			success: false,
			error: `Directory "${dir}" does not exist`,
		};
	}

	// Execute command
	const timeout = params.timeout || 30000;
	const maxStdoutBytes = readByteCap(
		config.maxStdoutBytes,
		'COREBRAIN_EXEC_MAX_STDOUT_BYTES',
		DEFAULT_MAX_STDOUT_BYTES,
	);
	const maxStderrBytes = readByteCap(
		config.maxStderrBytes,
		'COREBRAIN_EXEC_MAX_STDERR_BYTES',
		DEFAULT_MAX_STDERR_BYTES,
	);
	const result = await executeCommand(
		params.command,
		dir,
		timeout,
		maxStdoutBytes,
		maxStderrBytes,
	);

	const truncationNote = buildTruncationNote(result, maxStdoutBytes, maxStderrBytes);

	// success: true always — the tool itself executed. A non-zero exit
	// code is a user-land outcome, not a tool failure, and we want the
	// caller to see stdout/stderr/exitCode so the agent can interpret
	// what happened. Marking success: false drops the entire result
	// payload at the tool-group dispatch layer, leaving the caller with
	// only `TOOL_ERROR: unknown` and no way to diagnose.
	return {
		success: true,
		result: {
			command: params.command,
			dir,
			exitCode: result.code,
			stdout: result.stdout,
			stderr: result.stderr || undefined,
			...(result.stdoutTruncated && {
				stdoutTruncated: true,
				stdoutTotalBytes: result.stdoutTotalBytes,
			}),
			...(result.stderrTruncated && {
				stderrTruncated: true,
				stderrTotalBytes: result.stderrTotalBytes,
			}),
			...(result.killedForOversize && {killedForOversize: true}),
			...(truncationNote && {truncationNote}),
		},
	};
}

function readByteCap(
	configured: number | undefined,
	envVar: string,
	fallback: number,
): number {
	if (typeof configured === 'number' && configured > 0) return configured;
	const fromEnv = process.env[envVar];
	if (fromEnv) {
		const parsed = Number(fromEnv);
		if (Number.isFinite(parsed) && parsed > 0) return parsed;
	}
	return fallback;
}

function buildTruncationNote(
	r: ExecuteResult,
	stdoutCap: number,
	stderrCap: number,
): string | undefined {
	if (!r.stdoutTruncated && !r.stderrTruncated && !r.killedForOversize) {
		return undefined;
	}
	const parts: string[] = [];
	if (r.stdoutTruncated) {
		parts.push(
			`stdout exceeded ${formatBytes(stdoutCap)} cap (${formatBytes(r.stdoutTotalBytes)} total)`,
		);
	}
	if (r.stderrTruncated) {
		parts.push(
			`stderr exceeded ${formatBytes(stderrCap)} cap (${formatBytes(r.stderrTotalBytes)} total)`,
		);
	}
	if (r.killedForOversize) {
		parts.push('command was killed for runaway output');
	}
	return (
		parts.join('; ') +
		'. Use head/tail/grep/sed -n to narrow the next call, or redirect to a file and read a slice.'
	);
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
