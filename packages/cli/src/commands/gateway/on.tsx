import { useEffect } from 'react';
import { useApp } from 'ink';
import * as p from '@clack/prompts';
import chalk from 'chalk';
import zod from 'zod';
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

export const options = zod.object({});

type Props = {
	options: zod.infer<typeof options>;
};

function getGatewayEntryPath(): string {
	const __filename = fileURLToPath(import.meta.url);
	const __dirname = dirname(__filename);
	return join(__dirname, '..', '..', 'server', 'gateway-entry.js');
}

async function runGatewayOn(): Promise<void> {
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

	const serviceConfig: ServiceConfig = {
		name: serviceName,
		displayName: 'CoreBrain Gateway',
		command: process.execPath,
		args: [gatewayEntryPath],
		port: 0,
		workingDirectory: homedir(),
		logPath: join(logDir, 'gateway-stdout.log'),
		errorLogPath: join(logDir, 'gateway-stderr.log'),
	};

	await installService(serviceConfig);

	// Start the service
	spinner.message('Starting gateway service...');
	await startService(serviceName);

	// Wait a moment for the service to start and get the PID
	await new Promise(resolve => setTimeout(resolve, 500));
	const pid = getServicePid(serviceName);

	// Update preferences with actual PID
	updatePreferences({
		gateway: {
			...getPreferences().gateway,
			port: 0,
			pid: pid ?? 0,
			startedAt: Date.now(),
			serviceInstalled: true,
			serviceType: serviceType,
			serviceName: serviceName,
		},
	});

	spinner.stop(chalk.green('Gateway service started'));

	p.note(
		[
			'The gateway is now running in the background.',
			"Use 'corebrain gateway status' to check status.",
			"Use 'corebrain gateway off' to stop.",
		].join('\n'),
		'Gateway Started'
	);
}

export default function GatewayOn(_props: Props) {
	const { exit } = useApp();

	useEffect(() => {
		runGatewayOn()
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
