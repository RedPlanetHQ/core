import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import type { ServiceConfig, ServiceStatus } from './index';

export const SYSTEMD_SERVICE_NAME = 'corebrain-gateway';

const SYSTEMD_USER_DIR = join(homedir(), '.config', 'systemd', 'user');

/**
 * Get the full PATH from the user's login shell.
 * This ensures we capture paths added in .bashrc, .zshrc, etc.
 */
function getLoginShellPath(): string {
	const shell = process.env.SHELL || '/bin/bash';
	try {
		// Spawn a login shell to get the full PATH
		const result = execSync(`${shell} -l -c 'echo $PATH'`, {
			encoding: 'utf-8',
			stdio: ['pipe', 'pipe', 'pipe'],
		});
		const loginPath = result.trim();
		if (loginPath) {
			return loginPath;
		}
	} catch {
		// Fall through to process.env.PATH
	}
	return process.env.PATH || '/usr/local/bin:/usr/bin:/bin';
}

function getServiceFilePath(name: string): string {
	return join(SYSTEMD_USER_DIR, `${name}.service`);
}

function generateServiceUnit(config: ServiceConfig): string {
	// Expand ~ to home directory for log paths
	const expandPath = (p: string) => p.replace(/^~/, homedir());
	const logPath = expandPath(config.logPath);
	const errorLogPath = expandPath(config.errorLogPath);

	// Ensure log directory exists
	const logDir = logPath.substring(0, logPath.lastIndexOf('/'));
	if (!existsSync(logDir)) {
		mkdirSync(logDir, { recursive: true });
	}

	// Build ExecStart command
	const execStart = [config.command, ...config.args].join(' ');

	return `[Unit]
Description=${config.displayName}
After=network.target

[Service]
Type=simple
ExecStart=${execStart}
WorkingDirectory=${config.workingDirectory}
Restart=on-failure
RestartSec=5
StandardOutput=append:${logPath}
StandardError=append:${errorLogPath}
Environment=PATH=${getLoginShellPath()}

[Install]
WantedBy=default.target
`;
}

/**
 * Install the gateway as a systemd user service
 */
export async function installSystemdService(config: ServiceConfig): Promise<void> {
	// Ensure systemd user directory exists
	if (!existsSync(SYSTEMD_USER_DIR)) {
		mkdirSync(SYSTEMD_USER_DIR, { recursive: true });
	}

	const servicePath = getServiceFilePath(config.name);

	// Stop existing service if running
	try {
		execSync(`systemctl --user stop ${config.name}`, { stdio: 'ignore' });
	} catch {
		// Ignore errors if service wasn't running
	}

	// Generate and write service file
	const serviceContent = generateServiceUnit(config);
	writeFileSync(servicePath, serviceContent, 'utf-8');

	// Reload systemd daemon
	try {
		execSync('systemctl --user daemon-reload', { stdio: 'pipe' });
	} catch (error) {
		throw new Error(
			`Failed to reload systemd daemon: ${error instanceof Error ? error.message : String(error)}`,
		);
	}

	// Enable the service (start on login)
	try {
		execSync(`systemctl --user enable ${config.name}`, { stdio: 'pipe' });
	} catch (error) {
		throw new Error(
			`Failed to enable systemd service: ${error instanceof Error ? error.message : String(error)}`,
		);
	}

	// Start the service
	try {
		execSync(`systemctl --user start ${config.name}`, { stdio: 'pipe' });
	} catch (error) {
		throw new Error(
			`Failed to start systemd service: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
}

/**
 * Uninstall the systemd user service
 */
export async function uninstallSystemdService(name: string): Promise<void> {
	const servicePath = getServiceFilePath(name);

	// Stop the service
	try {
		execSync(`systemctl --user stop ${name}`, { stdio: 'ignore' });
	} catch {
		// Ignore errors if service wasn't running
	}

	// Disable the service
	try {
		execSync(`systemctl --user disable ${name}`, { stdio: 'ignore' });
	} catch {
		// Ignore errors if service wasn't enabled
	}

	// Remove the service file
	if (existsSync(servicePath)) {
		unlinkSync(servicePath);
	}

	// Reload systemd daemon
	try {
		execSync('systemctl --user daemon-reload', { stdio: 'ignore' });
	} catch {
		// Ignore errors
	}
}

/**
 * Check if the systemd service is installed
 */
export function isSystemdServiceInstalled(name: string): boolean {
	const servicePath = getServiceFilePath(name);
	return existsSync(servicePath);
}

/**
 * Get the status of the systemd service
 */
export async function getSystemdServiceStatus(name: string): Promise<ServiceStatus> {
	if (!isSystemdServiceInstalled(name)) {
		return 'not-installed';
	}

	try {
		const output = execSync(`systemctl --user is-active ${name} 2>/dev/null`, {
			encoding: 'utf-8',
		});

		const status = output.trim();
		if (status === 'active') {
			return 'running';
		}

		return 'stopped';
	} catch {
		// Service not active or error checking
		return 'stopped';
	}
}

/**
 * Start the systemd service
 */
export async function startSystemdService(name: string): Promise<void> {
	if (!isSystemdServiceInstalled(name)) {
		throw new Error(`Service ${name} is not installed`);
	}

	try {
		execSync(`systemctl --user start ${name}`, { stdio: 'pipe' });
	} catch (error) {
		throw new Error(
			`Failed to start service: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
}

/**
 * Stop the systemd service
 */
export async function stopSystemdService(name: string): Promise<void> {
	try {
		execSync(`systemctl --user stop ${name}`, { stdio: 'pipe' });
	} catch (error) {
		throw new Error(
			`Failed to stop service: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
}

/**
 * Get the PID of the running systemd service
 */
export function getSystemdServicePid(name: string): number | null {
	try {
		const output = execSync(`systemctl --user show ${name} --property=MainPID 2>/dev/null`, {
			encoding: 'utf-8',
		});

		const match = output.match(/MainPID=(\d+)/);
		if (match) {
			const pid = parseInt(match[1], 10);
			if (pid > 0) {
				return pid;
			}
		}

		return null;
	} catch {
		return null;
	}
}
