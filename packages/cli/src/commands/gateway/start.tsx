import { useEffect } from 'react';
import { useApp } from 'ink';
import * as p from '@clack/prompts';
import chalk from 'chalk';
import zod from 'zod';
import { spawn as spawnChild } from 'node:child_process';
import { getConfig } from '@/config/index';
import { getPreferences, updatePreferences } from '@/config/preferences';
import { getConfigPath } from '@/config/paths';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	installService,
	getServiceStatus,
	startService,
	getServiceName,
	getServiceType,
	getServicePid,
} from '@/utils/service-manager';
import type { ServiceConfig } from '@/utils/service-manager';
import { initializeDefaultProfiles } from '@/utils/browser-config';

export const options = zod.object({
	alwaysOn: zod
		.boolean()
		.default(false)
		.describe('Prevent mac from sleeping while gateway is running (macOS only)'),
	foreground: zod
		.boolean()
		.default(false)
		.describe('Run the gateway attached to the current terminal (for Docker / ad-hoc hosts without launchd/systemd)'),
});

type Props = {
	options: zod.infer<typeof options>;
};

function buildServiceCommand(
	nodeExec: string,
	entryPath: string,
	alwaysOn: boolean,
): { command: string; args: string[] } {
	if (alwaysOn) {
		if (process.platform === 'darwin') {
			// caffeinate -i: prevent idle sleep while child process runs
			return { command: '/usr/bin/caffeinate', args: ['-i', nodeExec, entryPath] };
		}
		if (process.platform === 'linux') {
			// systemd-inhibit: hold a sleep+idle inhibitor lock while child runs
			return {
				command: 'systemd-inhibit',
				args: [
					'--what=sleep:idle',
					'--who=CoreBrain Gateway',
					'--why=Gateway is running',
					'--mode=block',
					nodeExec,
					entryPath,
				],
			};
		}
		if (process.platform === 'win32') {
			// SetThreadExecutionState via PowerShell: prevents sleep while node runs
			const psScript = [
				'Add-Type -Name Power -Namespace Win32 -MemberDefinition \'[DllImport("kernel32.dll")] public static extern uint SetThreadExecutionState(uint s);\';',
				'[Win32.Power]::SetThreadExecutionState(0x80000003) | Out-Null;', // ES_CONTINUOUS | ES_SYSTEM_REQUIRED | ES_AWAYMODE_REQUIRED
				`& '${nodeExec}' '${entryPath}';`,
				'[Win32.Power]::SetThreadExecutionState(0x80000000) | Out-Null;', // ES_CONTINUOUS (clear)
			].join(' ');
			return {
				command: 'powershell.exe',
				args: ['-NoProfile', '-NonInteractive', '-Command', psScript],
			};
		}
	}
	return { command: nodeExec, args: [entryPath] };
}

function getGatewayEntryPath(): string {
	const __filename = fileURLToPath(import.meta.url);
	const __dirname = dirname(__filename);
	return join(__dirname, '..', '..', 'server', 'gateway-entry.js');
}

async function runGatewayStart(alwaysOn: boolean): Promise<void> {
	const spinner = p.spinner();

	// Check platform support
	const serviceType = getServiceType();
	if (serviceType === 'none') {
		p.log.error('Service management not supported on this platform. Only macOS (launchd) and Linux (systemd) are supported.');
		process.exitCode = 1;
		return;
	}

	// Check if authenticated
	spinner.start('Checking configuration...');
	const config = getConfig();

	if (!config.auth?.apiKey || !config.auth?.url) {
		spinner.stop(chalk.red('Not authenticated'));
		p.log.error('Not authenticated. Run `corebrain login` first.');
		process.exitCode = 1;
		return;
	}

	// Check if gateway is configured
	const prefs = getPreferences();
	if (!prefs.gateway?.id || !prefs.gateway?.name) {
		spinner.stop(chalk.red('Not configured'));
		p.log.error('Gateway not configured. Run `corebrain gateway config` first.');
		process.exitCode = 1;
		return;
	}

	const serviceName = getServiceName();

	// Check if already running
	const currentStatus = await getServiceStatus(serviceName);
	if (currentStatus === 'running') {
		spinner.stop(chalk.green('Gateway is already running'));
		return;
	}

	// Install/update the service
	spinner.message('Installing gateway service...');

	const gatewayEntryPath = getGatewayEntryPath();
	const logDir = join(getConfigPath(), 'logs');
	const { command, args } = buildServiceCommand(process.execPath, gatewayEntryPath, alwaysOn);

	const serviceConfig: ServiceConfig = {
		name: serviceName,
		displayName: 'CoreBrain Gateway',
		command,
		args,
		port: 0,
		workingDirectory: homedir(),
		logPath: join(logDir, 'gateway-stdout.log'),
		errorLogPath: join(logDir, 'gateway-stderr.log'),
	};

	await installService(serviceConfig);

	// Start the service
	spinner.message('Starting gateway service...');
	await startService(serviceName);

	// Initialize default browser sessions if not already configured
	initializeDefaultProfiles();

	// Wait a moment for the service to start and get the PID
	await new Promise(resolve => setTimeout(resolve, 500));
	const pid = getServicePid(serviceName);

	// Update preferences with actual PID
	updatePreferences({
		gateway: {
			...getPreferences().gateway,
			pid: pid ?? 0,
			startedAt: Date.now(),
			serviceInstalled: true,
			serviceType: serviceType,
			serviceName: serviceName,
			alwaysOn,
		},
	});

	spinner.stop(chalk.green('Gateway started'));

	p.note(
		[
			'The gateway is now running in the background.',
			"Use 'corebrain gateway status' to check status.",
			"Use 'corebrain gateway stop' to stop and remove.",
		].join('\n'),
		'Gateway Started'
	);
}

export default function GatewayStart({ options: { alwaysOn } }: Props) {
	const { exit } = useApp();

	useEffect(() => {
		runGatewayStart(alwaysOn)
			.catch((err) => {
				p.log.error(`Gateway error: ${err instanceof Error ? err.message : 'Unknown error'}`);
				process.exitCode = 1;
			})
			.finally(() => {
				setTimeout(() => exit(), 100);
			});
	}, [exit]);

	return null;
}
