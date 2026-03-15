import {spawn, execSync} from 'node:child_process';
import {existsSync, mkdirSync, openSync, statSync} from 'node:fs';
import {join} from 'node:path';
import {homedir} from 'node:os';
import {getPreferences} from '@/config/preferences';
import type {CliBackendConfig} from '@/types/config';
import {getSession, deleteSession, isProcessRunningByPid} from '@/utils/coding-sessions';

export function getAgentConfig(agentName: string): CliBackendConfig | null {
	const prefs = getPreferences();
	const coding = prefs.coding as Record<string, CliBackendConfig> | undefined;
	if (!coding || !coding[agentName]) {
		return null;
	}
	return coding[agentName];
}

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

	if (config.sessionArg && config.sessionMode === 'always') {
		args.push(config.sessionArg, params.sessionId);
	}

	if (config.allowedTools && config.allowedTools.length > 0) {
		for (const tool of config.allowedTools) {
			args.push('--allowedTools', tool);
		}
	}

	if (config.disallowedTools && config.disallowedTools.length > 0) {
		for (const tool of config.disallowedTools) {
			args.push('--disallowedTools', tool);
		}
	}

	if (params.model && config.modelArg) {
		args.push(config.modelArg, params.model);
	}

	if (params.systemPrompt && config.systemPromptArg) {
		args.push(config.systemPromptArg, params.systemPrompt);
	}

	args.push(params.prompt);
	return args;
}

export function buildResumeArgs(
	config: CliBackendConfig,
	params: {prompt: string; sessionId: string},
): string[] {
	if (config.resumeArgs) {
		const args = config.resumeArgs.map(arg =>
			arg.replace('{sessionId}', params.sessionId),
		);
		args.push(params.prompt);
		return args;
	}
	return buildStartArgs(config, params);
}

export function getSessionLogPath(sessionId: string, stream: 'stdout' | 'stderr'): string {
	return join(homedir(), '.corebrain', 'logs', `${sessionId}.${stream}.log`);
}

function ensureLogsDir(): void {
	const logsDir = join(homedir(), '.corebrain', 'logs');
	if (!existsSync(logsDir)) {
		mkdirSync(logsDir, {recursive: true});
	}
}

export type Logger = (message: string) => void;

export function startAgentProcess(
	sessionId: string,
	config: CliBackendConfig,
	args: string[],
	workingDirectory: string,
	logger?: Logger,
): {pid: number | undefined; error?: string} {
	const log = logger || (() => {});

	log(`SPAWN_START: sessionId=${sessionId}`);
	log(`SPAWN_COMMAND: ${config.command}`);
	log(`SPAWN_ARGS: ${JSON.stringify(args)}`);
	log(`SPAWN_CWD: ${workingDirectory}`);

	ensureLogsDir();

	const stdoutFd = openSync(getSessionLogPath(sessionId, 'stdout'), 'w');
	const stderrFd = openSync(getSessionLogPath(sessionId, 'stderr'), 'w');

	let proc;
	try {
		proc = spawn(config.command, args, {
			cwd: workingDirectory,
			shell: false,
			stdio: ['ignore', stdoutFd, stderrFd],
			detached: true,
		});
	} catch (err) {
		const errorMsg = err instanceof Error ? err.message : String(err);
		log(`SPAWN_ERROR: ${errorMsg}`);
		return {pid: undefined, error: errorMsg};
	}

	const pid = proc.pid;
	log(`SPAWN_PID: ${pid}`);

	proc.on('error', (err) => log(`SPAWN_PROCESS_ERROR: ${err.message}`));
	proc.on('exit', (code, signal) => log(`SPAWN_EXIT: pid=${pid} code=${code} signal=${signal}`));

	proc.unref();
	log(`SPAWN_DETACHED: process detached and running`);

	return {pid};
}

export function isProcessRunning(sessionId: string): boolean {
	const session = getSession(sessionId);
	if (!session?.pid) return false;
	return isProcessRunningByPid(session.pid);
}

export function stopProcess(sessionId: string): boolean {
	const session = getSession(sessionId);
	if (!session?.pid) return false;

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
 * Safely remove a git worktree — skips removal if there are uncommitted changes.
 */
function tryRemoveWorktree(worktreePath: string, repoDir: string): void {
	try {
		const status = execSync(`git -C ${JSON.stringify(worktreePath)} status --porcelain`, {stdio: 'pipe'})
			.toString()
			.trim();
		if (status.length > 0) return; // uncommitted changes — leave it
		execSync(`git -C ${JSON.stringify(repoDir)} worktree remove ${JSON.stringify(worktreePath)}`, {stdio: 'pipe'});
	} catch { /* best-effort */ }
}

/**
 * Start a background watchdog for a running session.
 * If the stdout log has not grown for `idleTimeoutMs` (default 30s), the process is killed.
 * Also cleans up the running session record when the process exits naturally.
 */
export function startIdleWatchdog(
	sessionId: string,
	pid: number,
	idleTimeoutMs = 30_000,
): void {
	const logPath = getSessionLogPath(sessionId, 'stdout');
	const pollInterval = 5_000;
	let lastSize = -1;
	let lastChangedAt = Date.now();

	function check() {
		// Process already dead — clean up session record and stop
		if (!isProcessRunningByPid(pid)) {
			const session = getSession(sessionId);
			if (session?.worktreePath) {
				tryRemoveWorktree(session.worktreePath, session.dir);
			}
			deleteSession(sessionId);
			return;
		}

		let currentSize = 0;
		try {
			currentSize = statSync(logPath).size;
		} catch { /* log not created yet */ }

		if (currentSize !== lastSize) {
			lastSize = currentSize;
			lastChangedAt = Date.now();
		} else if (Date.now() - lastChangedAt >= idleTimeoutMs) {
			// Idle too long — kill and clean up
			try {
				process.kill(pid, 'SIGTERM');
			} catch { /* already gone */ }
			const session = getSession(sessionId);
			if (session?.worktreePath) {
				tryRemoveWorktree(session.worktreePath, session.dir);
			}
			deleteSession(sessionId);
			return;
		}

		setTimeout(check, pollInterval);
	}

	setTimeout(check, pollInterval);
}
