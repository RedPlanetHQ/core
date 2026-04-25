import {getPreferences} from '@/config/preferences';
import type {CliBackendConfig} from '@/types/config';
import {getSession} from '@/utils/coding-sessions';
import {ptyManager} from '@/server/pty/manager';

export function getAgentConfig(agentName: string): CliBackendConfig | null {
	const prefs = getPreferences();
	const coding = prefs.coding as Record<string, CliBackendConfig> | undefined;
	if (!coding || !coding[agentName]) {
		return null;
	}
	return coding[agentName];
}

/**
 * Build CLI args for starting an agent's interactive TUI. If `prompt` is
 * provided, it's appended as the final positional arg so the agent processes
 * it on startup; otherwise the TUI launches blank (used by the xterm spawn
 * path). Session id flows through `sessionArg` when the agent supports it.
 */
export function buildStartArgs(
	config: CliBackendConfig,
	params: {
		prompt?: string;
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

	if (params.prompt) {
		args.push(params.prompt);
	}
	return args;
}

/**
 * Build CLI args for resuming an agent via `resumeArgs` (`{sessionId}` is
 * substituted). Prompt is optional — omit for a blank-resume into the TUI,
 * set for a prompt-on-resume flow.
 */
export function buildResumeArgs(
	config: CliBackendConfig,
	params: {prompt?: string; sessionId: string},
): string[] {
	if (config.resumeArgs) {
		const args = config.resumeArgs.map(arg =>
			arg.replace('{sessionId}', params.sessionId),
		);
		if (params.prompt) args.push(params.prompt);
		return args;
	}
	return buildStartArgs(config, params);
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

	try {
		const {pid} = ptyManager.spawn({
			sessionId,
			command: config.command,
			args,
			cwd: workingDirectory,
		});
		log(`SPAWN_PID: ${pid}`);
		return {pid};
	} catch (err) {
		const errorMsg = err instanceof Error ? err.message : String(err);
		log(`SPAWN_ERROR: ${errorMsg}`);
		return {pid: undefined, error: errorMsg};
	}
}

export function isProcessRunning(sessionId: string): boolean {
	// Primary source: PtyManager in-memory state for agents spawned under this
	// daemon. Falls back to PID-probe for legacy session records that may have
	// been started before the PTY refactor.
	if (ptyManager.isRunning(sessionId)) return true;

	const session = getSession(sessionId);
	if (!session?.pid) return false;
	try {
		process.kill(session.pid, 0);
		return true;
	} catch {
		return false;
	}
}

export function stopProcess(sessionId: string): boolean {
	if (ptyManager.isRunning(sessionId)) {
		return ptyManager.kill(sessionId, 'SIGTERM');
	}

	// Legacy path: kill by stored PID if PTY manager doesn't know about it.
	const session = getSession(sessionId);
	if (!session?.pid) return false;
	try {
		process.kill(session.pid, 'SIGTERM');
		return true;
	} catch {
		return false;
	}
}

