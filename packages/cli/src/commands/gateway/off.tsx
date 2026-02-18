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
} from '@/utils/service-manager/index';

export const options = zod.object({});

type Props = {
	options: zod.infer<typeof options>;
};

async function runGatewayOff(): Promise<void> {
	const spinner = p.spinner();

	// Check platform support
	const serviceType = getServiceType();
	if (serviceType === 'none') {
		p.log.error('Service management not supported on this platform.');
		return;
	}

	spinner.start('Checking gateway status...');

	const serviceName = getServiceName();
	const installed = await isServiceInstalled(serviceName);

	if (!installed) {
		spinner.stop(chalk.yellow('Gateway is not installed'));
		p.log.warning('Run: corebrain gateway on');
		return;
	}

	// Check if running
	const serviceStatus = await getServiceStatus(serviceName);

	if (serviceStatus !== 'running') {
		spinner.stop(chalk.yellow('Gateway is not running'));
		return;
	}

	// Stop the service
	spinner.message('Stopping gateway...');
	await stopService(serviceName);
	await new Promise((resolve) => setTimeout(resolve, 1000));

	// Verify stopped
	const postStopStatus = await getServiceStatus(serviceName);
	if (postStopStatus === 'running') {
		spinner.stop(chalk.red('Failed to stop'));
		p.log.error('Stop command sent but service is still running');
		return;
	}

	spinner.stop(chalk.green('Gateway stopped'));

	p.note(
		[
			'Note: Will auto-start on next login.',
			'To remove completely: corebrain gateway uninstall',
		].join('\n'),
		'Gateway Stopped'
	);
}

export default function GatewayOff(_props: Props) {
	const { exit } = useApp();

	useEffect(() => {
		runGatewayOff()
			.catch((err) => {
				p.log.error(`Failed to stop gateway: ${err instanceof Error ? err.message : 'Unknown error'}`);
			})
			.finally(() => {
				setTimeout(() => exit(), 100);
			});
	}, [exit]);

	return null;
}
