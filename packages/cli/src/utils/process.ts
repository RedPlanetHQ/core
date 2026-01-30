import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const COREBRAIN_DIR = join(homedir(), '.corebrain');
const LOGS_DIR = join(COREBRAIN_DIR, 'logs');

// Ensure directories exist
if (!existsSync(COREBRAIN_DIR)) {
	mkdirSync(COREBRAIN_DIR, { recursive: true });
}
if (!existsSync(LOGS_DIR)) {
	mkdirSync(LOGS_DIR, { recursive: true });
}

export interface SpawnOptions {
	cwd?: string;
	env?: NodeJS.ProcessEnv;
	logFile?: string;
}

/**
 * Spawn a detached background process that continues running after parent exits
 */
export function spawnDetached(
	command: string,
	args: string[],
	options: SpawnOptions = {}
): number {
	const logFile = options.logFile || join(LOGS_DIR, `gateway-${Date.now()}.log`);

	const child = spawn(command, args, {
		detached: true,
		stdio: 'ignore', // Detach from parent's stdio
		cwd: options.cwd || process.cwd(),
		env: { ...process.env, ...options.env },
	});

	// Unref so parent can exit independently
	child.unref();

	// Write PID to log for debugging
	writeFileSync(logFile, `Started process ${child.pid} at ${new Date().toISOString()}\n`);

	if (!child.pid) {
		throw new Error('Failed to spawn process - no PID returned');
	}

	return child.pid;
}

/**
 * Check if a process is running by PID
 */
export function isPidRunning(pid: number): boolean {
	try {
		// Sending signal 0 checks if process exists without killing it
		process.kill(pid, 0);
		return true;
	} catch (error) {
		return false;
	}
}

/**
 * Kill a process by PID
 */
export function killProcess(pid: number, signal: NodeJS.Signals = 'SIGTERM'): boolean {
	try {
		process.kill(pid, signal);
		return true;
	} catch (error) {
		return false;
	}
}

/**
 * Kill a process and wait for it to exit
 */
export async function killProcessAndWait(
	pid: number,
	timeout = 5000
): Promise<boolean> {
	if (!isPidRunning(pid)) {
		return true; // Already dead
	}

	// Try graceful shutdown first
	killProcess(pid, 'SIGTERM');

	const start = Date.now();
	while (Date.now() - start < timeout) {
		await new Promise(resolve => setTimeout(resolve, 100));
		if (!isPidRunning(pid)) {
			return true;
		}
	}

	// Force kill if still running
	killProcess(pid, 'SIGKILL');

	// Wait a bit more
	await new Promise(resolve => setTimeout(resolve, 500));

	return !isPidRunning(pid);
}
