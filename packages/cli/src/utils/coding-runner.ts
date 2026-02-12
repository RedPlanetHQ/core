import {spawn, type ChildProcess} from 'node:child_process';
import {getPreferences} from '@/config/preferences';
import type {CliBackendConfig} from '@/types/config';
import {completeSession} from '@/utils/coding-sessions';

// Track running processes in memory
interface RunningProcess {
	process: ChildProcess;
	stdout: string;
	stderr: string;
	exitCode: number | null;
	startedAt: number;
}

const runningProcesses = new Map<string, RunningProcess>();

// Cleanup delay after process exits (ms) - gives time to read final output
const CLEANUP_DELAY = 5000;

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
		const args = config.resumeArgs.map((arg) =>
			arg.replace('{sessionId}', params.sessionId),
		);
		args.push(params.prompt);
		return args;
	}

	// Fallback to start args with session
	return buildStartArgs(config, params);
}

/**
 * Start an agent process in the background
 * Returns immediately, process runs in background
 * Auto-saves output and cleans up memory when process exits
 */
export function startAgentProcess(
	sessionId: string,
	config: CliBackendConfig,
	args: string[],
	workingDirectory: string,
): {pid: number | undefined} {
	const proc = spawn(config.command, args, {
		cwd: workingDirectory,
		shell: true,
		stdio: ['pipe', 'pipe', 'pipe'],
		detached: false,
	});

	const runningProc: RunningProcess = {
		process: proc,
		stdout: '',
		stderr: '',
		exitCode: null,
		startedAt: Date.now(),
	};

	// Collect stdout
	proc.stdout?.on('data', (data) => {
		runningProc.stdout += data.toString();
	});

	// Collect stderr
	proc.stderr?.on('data', (data) => {
		runningProc.stderr += data.toString();
	});

	// Handle process exit - save to sessions.json and schedule cleanup
	proc.on('close', (code) => {
		runningProc.exitCode = code;

		// Save final output to sessions.json
		completeSession(
			sessionId,
			runningProc.stdout,
			code === 0,
			runningProc.stderr || undefined,
		);

		// Schedule cleanup after delay to allow final reads
		setTimeout(() => {
			runningProcesses.delete(sessionId);
		}, CLEANUP_DELAY);
	});

	proc.on('error', (err) => {
		runningProc.stderr += `\nProcess error: ${err.message}`;
		runningProc.exitCode = 1;

		// Save error to sessions.json
		completeSession(sessionId, runningProc.stdout, false, runningProc.stderr);

		// Schedule cleanup
		setTimeout(() => {
			runningProcesses.delete(sessionId);
		}, CLEANUP_DELAY);
	});

	runningProcesses.set(sessionId, runningProc);

	return {pid: proc.pid};
}

/**
 * Read output from a running or completed process
 */
export function readProcessOutput(sessionId: string): {
	found: boolean;
	stdout: string;
	stderr: string;
	running: boolean;
	exitCode: number | null;
} {
	const proc = runningProcesses.get(sessionId);
	if (!proc) {
		return {
			found: false,
			stdout: '',
			stderr: '',
			running: false,
			exitCode: null,
		};
	}

	return {
		found: true,
		stdout: proc.stdout,
		stderr: proc.stderr,
		running: proc.exitCode === null,
		exitCode: proc.exitCode,
	};
}

/**
 * Check if a process is still running
 */
export function isProcessRunning(sessionId: string): boolean {
	const proc = runningProcesses.get(sessionId);
	return proc ? proc.exitCode === null : false;
}

/**
 * Stop/kill a running process
 */
export function stopProcess(sessionId: string): boolean {
	const proc = runningProcesses.get(sessionId);
	if (proc && proc.exitCode === null) {
		proc.process.kill('SIGTERM');
		return true;
	}
	return false;
}

/**
 * Clean up a process from memory
 */
export function cleanupProcess(sessionId: string): void {
	runningProcesses.delete(sessionId);
}

/**
 * Get process info
 */
export function getProcessInfo(sessionId: string): {
	pid: number | undefined;
	running: boolean;
	startedAt: number;
} | null {
	const proc = runningProcesses.get(sessionId);
	if (!proc) {
		return null;
	}
	return {
		pid: proc.process.pid,
		running: proc.exitCode === null,
		startedAt: proc.startedAt,
	};
}
