import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);

/**
 * Check if tmux is installed and available
 */
export async function isTmuxAvailable(): Promise<boolean> {
	try {
		await execAsync('which tmux');
		return true;
	} catch {
		return false;
	}
}

/**
 * Check if a tmux session exists
 */
export async function sessionExists(name: string): Promise<boolean> {
	try {
		await execAsync(`tmux has-session -t ${name} 2>/dev/null`);
		return true;
	} catch {
		return false;
	}
}

/**
 * Create a new detached tmux session with a command
 */
export async function createSession(
	name: string,
	command: string,
): Promise<void> {
	await execAsync(`tmux new-session -d -s ${name} '${command}'`);
}

/**
 * Kill a tmux session
 */
export async function killSession(name: string): Promise<void> {
	await execAsync(`tmux kill-session -t ${name}`);
}

/**
 * Get the PID of a tmux session
 */
export async function getSessionPid(name: string): Promise<number | null> {
	try {
		const { stdout } = await execAsync(
			`tmux list-panes -t ${name} -F '#{pane_pid}' | head -n 1`,
		);
		const pid = parseInt(stdout.trim(), 10);
		return isNaN(pid) ? null : pid;
	} catch {
		return null;
	}
}

/**
 * List all tmux sessions
 */
export async function listSessions(): Promise<string[]> {
	try {
		const { stdout } = await execAsync(`tmux list-sessions -F '#{session_name}'`);
		return stdout.trim().split('\n').filter(Boolean);
	} catch {
		return [];
	}
}

/**
 * Get the content of a tmux pane
 */
export async function getSessionContent(
	name: string,
	lines = 100,
): Promise<string> {
	try {
		const { stdout } = await execAsync(
			`tmux capture-pane -t ${name} -p -S -${lines}`,
		);
		return stdout;
	} catch {
		return '';
	}
}

/**
 * Send keys to a tmux session
 */
export async function sendKeys(name: string, keys: string): Promise<void> {
	await execAsync(`tmux send-keys -t ${name} '${keys}' Enter`);
}

/**
 * Check if a process with the given PID is running
 */
export function isPidRunning(pid: number): boolean {
	try {
		// Sending signal 0 checks if process exists without killing it
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}
