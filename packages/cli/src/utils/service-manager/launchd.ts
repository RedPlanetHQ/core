import {execSync, spawn} from 'node:child_process';
import {
	existsSync,
	mkdirSync,
	writeFileSync,
	unlinkSync,
	readFileSync,
} from 'node:fs';
import {join} from 'node:path';
import {homedir} from 'node:os';
import type {ServiceConfig, ServiceStatus} from './index';

export const LAUNCHD_SERVICE_NAME = 'dev.corebrain.gateway';

const LAUNCH_AGENTS_DIR = join(homedir(), 'Library', 'LaunchAgents');

function getPlistPath(name: string): string {
	return join(LAUNCH_AGENTS_DIR, `${name}.plist`);
}

function generatePlist(config: ServiceConfig): string {
	// Expand ~ to home directory for log paths
	const expandPath = (p: string) => p.replace(/^~/, homedir());
	const logPath = expandPath(config.logPath);
	const errorLogPath = expandPath(config.errorLogPath);

	// Ensure log directory exists
	const logDir = logPath.substring(0, logPath.lastIndexOf('/'));
	if (!existsSync(logDir)) {
		mkdirSync(logDir, {recursive: true});
	}

	// Build program arguments array
	const programArgs = [config.command, ...config.args]
		.map(arg => `		<string>${escapeXml(arg)}</string>`)
		.join('\n');

	const userPath = process.env.PATH;

	return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>Label</key>
	<string>${escapeXml(config.name)}</string>
	<key>ProgramArguments</key>
	<array>
${programArgs}
	</array>
	<key>WorkingDirectory</key>
	<string>${escapeXml(config.workingDirectory)}</string>
	<key>RunAtLoad</key>
	<true/>
	<key>KeepAlive</key>
	<dict>
		<key>SuccessfulExit</key>
		<false/>
	</dict>
	<key>StandardOutPath</key>
	<string>${escapeXml(logPath)}</string>
	<key>StandardErrorPath</key>
	<string>${escapeXml(errorLogPath)}</string>
	<key>EnvironmentVariables</key>
	<dict>
		<key>PATH</key>
		<string>${userPath}</string>
	</dict>
</dict>
</plist>
`;
}

function escapeXml(str: string): string {
	return str
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&apos;');
}

/**
 * Install the gateway as a launchd service
 */
export async function installLaunchdService(
	config: ServiceConfig,
): Promise<void> {
	// Ensure LaunchAgents directory exists
	if (!existsSync(LAUNCH_AGENTS_DIR)) {
		mkdirSync(LAUNCH_AGENTS_DIR, {recursive: true});
	}

	const plistPath = getPlistPath(config.name);

	// Unload existing service if it exists
	if (existsSync(plistPath)) {
		try {
			execSync(`launchctl unload "${plistPath}"`, {stdio: 'ignore'});
		} catch {
			// Ignore errors if service wasn't loaded
		}
	}

	// Generate and write plist file
	const plistContent = generatePlist(config);
	writeFileSync(plistPath, plistContent, 'utf-8');

	// Load the service
	try {
		execSync(`launchctl load "${plistPath}"`, {stdio: 'pipe'});
	} catch (error) {
		throw new Error(
			`Failed to load launchd service: ${
				error instanceof Error ? error.message : String(error)
			}`,
		);
	}
}

/**
 * Uninstall the launchd service
 */
export async function uninstallLaunchdService(name: string): Promise<void> {
	const plistPath = getPlistPath(name);

	if (!existsSync(plistPath)) {
		return; // Nothing to uninstall
	}

	// Unload the service
	try {
		execSync(`launchctl unload "${plistPath}"`, {stdio: 'ignore'});
	} catch {
		// Ignore errors if service wasn't loaded
	}

	// Remove the plist file
	unlinkSync(plistPath);
}

/**
 * Check if the launchd service is installed
 */
export function isLaunchdServiceInstalled(name: string): boolean {
	const plistPath = getPlistPath(name);
	return existsSync(plistPath);
}

/**
 * Get the status of the launchd service
 */
export async function getLaunchdServiceStatus(
	name: string,
): Promise<ServiceStatus> {
	if (!isLaunchdServiceInstalled(name)) {
		return 'not-installed';
	}

	try {
		// Use launchctl list | grep to get tabular format: "PID\tStatus\tLabel"
		const output = execSync(`launchctl list | grep "${name}" 2>/dev/null`, {
			encoding: 'utf-8',
		});

		// Parse output: "86602\t0\tdev.corebrain.gateway" or "-\t0\tdev.corebrain.gateway"
		const line = output.trim();
		if (line) {
			const parts = line.split(/\s+/);
			if (parts.length >= 1) {
				const pid = parts[0];
				if (pid && pid !== '-' && !isNaN(parseInt(pid, 10))) {
					return 'running';
				}
			}
		}

		return 'stopped';
	} catch {
		// Service not loaded or grep found nothing
		return 'stopped';
	}
}

/**
 * Start the launchd service
 */
export async function startLaunchdService(name: string): Promise<void> {
	const plistPath = getPlistPath(name);

	if (!existsSync(plistPath)) {
		throw new Error(`Service ${name} is not installed`);
	}

	try {
		// First ensure it's loaded
		execSync(`launchctl load "${plistPath}" 2>/dev/null`, {stdio: 'ignore'});
	} catch {
		// May already be loaded, ignore
	}

	try {
		// Start the service
		execSync(`launchctl start "${name}"`, {stdio: 'pipe'});
	} catch (error) {
		throw new Error(
			`Failed to start service: ${
				error instanceof Error ? error.message : String(error)
			}`,
		);
	}
}

/**
 * Stop the launchd service
 */
export async function stopLaunchdService(name: string): Promise<void> {
	try {
		execSync(`launchctl stop "${name}"`, {stdio: 'pipe'});
	} catch (error) {
		throw new Error(
			`Failed to stop service: ${
				error instanceof Error ? error.message : String(error)
			}`,
		);
	}
}

/**
 * Get the PID of the running launchd service
 */
export function getLaunchdServicePid(name: string): number | null {
	try {
		// Use launchctl list | grep to get tabular format
		const output = execSync(`launchctl list | grep "${name}" 2>/dev/null`, {
			encoding: 'utf-8',
		});

		const line = output.trim();
		if (line) {
			const parts = line.split(/\s+/);
			if (parts.length >= 1) {
				const pid = parseInt(parts[0], 10);
				if (!isNaN(pid) && pid > 0) {
					return pid;
				}
			}
		}

		return null;
	} catch {
		return null;
	}
}
