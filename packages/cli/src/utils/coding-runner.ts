import {spawn} from 'node:child_process';
import {existsSync, mkdirSync, openSync} from 'node:fs';
import {join} from 'node:path';
import {homedir} from 'node:os';
import {getPreferences} from '@/config/preferences';
import type {CliBackendConfig} from '@/types/config';
import {
	updateSession,
	getSession,
	isProcessRunningByPid,
} from '@/utils/coding-sessions';

/**
 * Get agent configuration by name
 */
export function getAgentConfig(agentName: string): CliBackendConfig | null {
	const prefs = getPreferences();
	const coding = prefs.coding as Record<string, CliBackendConfig> | undefined;
	if (!coding || !coding[agentName]) {
		return null;
	}
	return coding[agentName];
}

/**
 * Build command arguments for starting a new session
 */
export function buildStartArgs(
	config: CliBackendConfig,
	params: {
		prompt: string;
		sessionId: string;
		model?: string;
		systemPrompt?: string;
	},
): string[] {
	const args = [...(config.args || [])];

	// Add session arg
	if (config.sessionArg && config.sessionMode === 'always') {
		args.push(config.sessionArg, params.sessionId);
	}

	// Add allowed tools
	if (config.allowedTools && config.allowedTools.length > 0) {
		for (const tool of config.allowedTools) {
			args.push('--allowedTools', tool);
		}
	}

	// Add disallowed tools
	if (config.disallowedTools && config.disallowedTools.length > 0) {
		for (const tool of config.disallowedTools) {
			args.push('--disallowedTools', tool);
		}
	}

	// Add model
	if (params.model && config.modelArg) {
		args.push(config.modelArg, params.model);
	}

	// Add system prompt
	if (params.systemPrompt && config.systemPromptArg) {
		args.push(config.systemPromptArg, params.systemPrompt);
	}

	// Add the prompt as the last argument
	args.push(params.prompt);

	return args;
}

/**
 * Build command arguments for resuming an existing session
 */
export function buildResumeArgs(
	config: CliBackendConfig,
	params: {
		prompt: string;
		sessionId: string;
	},
): string[] {
	if (config.resumeArgs) {
		// Use resume args and replace {sessionId} placeholder
		const args = config.resumeArgs.map(arg =>
			arg.replace('{sessionId}', params.sessionId),
		);
		args.push(params.prompt);
		return args;
	}

	// Fallback to start args with session
	return buildStartArgs(config, params);
}

/**
 * Get path for session stdout/stderr log files
 */
function getSessionLogPath(
	sessionId: string,
	stream: 'stdout' | 'stderr',
): string {
	const logsDir = join(homedir(), '.corebrain', 'logs');
	return join(logsDir, `${sessionId}.${stream}.log`);
}

/**
 * Ensure logs directory exists
 */
function ensureLogsDir(): void {
	const logsDir = join(homedir(), '.corebrain', 'logs');

	if (!existsSync(logsDir)) {
		mkdirSync(logsDir, {recursive: true});
	}
}

/**
 * Start an agent process in the background (detached)
 * Returns immediately, CLI can exit while process continues
 * Output is written by the agent to its own session files (e.g., Claude Code writes to ~/.claude/projects/)
 */
export function startAgentProcess(
	sessionId: string,
	config: CliBackendConfig,
	args: string[],
	workingDirectory: string,
): {pid: number | undefined} {
	console.log(config.command, args);

	// Ensure logs directory exists
	ensureLogsDir();

	// Open log files for stdout/stderr (so we can see any errors from the process itself)
	const stdoutPath = getSessionLogPath(sessionId, 'stdout');
	const stderrPath = getSessionLogPath(sessionId, 'stderr');
	const stdoutFd = openSync(stdoutPath, 'w');
	const stderrFd = openSync(stderrPath, 'w');

	// Spawn detached process
	const proc = spawn(config.command, args, {
		cwd: workingDirectory,
		shell: true,
		stdio: ['ignore', stdoutFd, stderrFd],
		detached: true,
	});

	const pid = proc.pid;

	// Store PID in session
	const session = getSession(sessionId);
	if (session && pid) {
		session.pid = pid;
		session.updatedAt = Date.now();
		updateSession(session);
	}

	// Unref so parent can exit
	proc.unref();

	return {pid};
}

/**
 * Check if a process is still running by session ID
 */
export function isProcessRunning(sessionId: string): boolean {
	const session = getSession(sessionId);
	if (!session?.pid) {
		return false;
	}
	return isProcessRunningByPid(session.pid);
}

/**
 * Stop/kill a running process by session ID
 */
export function stopProcess(sessionId: string): boolean {
	const session = getSession(sessionId);
	if (!session?.pid) {
		return false;
	}

	if (isProcessRunningByPid(session.pid)) {
		try {
			process.kill(session.pid, 'SIGTERM');
			return true;
		} catch {
			return false;
		}
	}
	return false;
}

/**
 * Get process info from session
 */
export function getProcessInfo(sessionId: string): {
	pid: number | undefined;
	running: boolean;
	startedAt: number;
} | null {
	const session = getSession(sessionId);
	if (!session) {
		return null;
	}
	return {
		pid: session.pid,
		running: session.pid ? isProcessRunningByPid(session.pid) : false,
		startedAt: session.startedAt,
	};
}
