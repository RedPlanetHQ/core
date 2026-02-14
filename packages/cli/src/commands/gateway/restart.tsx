import { useEffect } from 'react';
import { useApp } from 'ink';
import * as p from '@clack/prompts';
import chalk from 'chalk';
import zod from 'zod';
import {
	getServiceType,
	getServiceName,
	isServiceInstalled,
	getServiceStatus,
	stopService,
	startService,
} from '@/utils/service-manager/index';

export const options = zod.object({});

type Props = {
	options: zod.infer<typeof options>;
};

async function runGatewayRestart(): Promise<void> {
	const spinner = p.spinner();

	const serviceType = getServiceType();

	if (serviceType === 'none') {
		p.log.error('Service management not supported on this platform.');
		return;
	}

	spinner.start('Checking gateway status...');

	const serviceName = getServiceName();
	const installed = await isServiceInstalled(serviceName);

	if (!installed) {
		spinner.stop(chalk.yellow('Not installed'));
		p.log.warning('Gateway not installed. Run: corebrain gateway on');
		return;
	}

	// Stop if running
	const serviceStatus = await getServiceStatus(serviceName);
	if (serviceStatus === 'running') {
		spinner.message('Stopping gateway...');
		await stopService(serviceName);
		await new Promise((resolve) => setTimeout(resolve, 1000));
	}

	// Start
	spinner.message('Starting gateway...');
	await startService(serviceName);
	await new Promise((resolve) => setTimeout(resolve, 1500));

	// Verify running
	const postStartStatus = await getServiceStatus(serviceName);
	if (postStartStatus !== 'running') {
		spinner.stop(chalk.red('Failed to restart'));
		p.log.error('Service started but not running. Check logs: ~/.corebrain/logs/');
		return;
	}

	spinner.stop(chalk.green('Gateway restarted'));
}

export default function GatewayRestart(_props: Props) {
	const { exit } = useApp();

	useEffect(() => {
		runGatewayRestart()
			.catch((err) => {
				p.log.error(`Failed to restart: ${err instanceof Error ? err.message : 'Unknown error'}`);
			})
			.finally(() => {
				setTimeout(() => exit(), 100);
			});
	}, [exit]);

	return null;
}
