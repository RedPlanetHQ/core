import { useEffect } from 'react';
import { useApp } from 'ink';
import * as p from '@clack/prompts';
import chalk from 'chalk';
import zod from 'zod';
import { getPreferences, updatePreferences } from '@/config/preferences';
import {
	getServiceType,
	getServiceName,
	uninstallService,
	isServiceInstalled,
	stopService,
	getServiceStatus,
} from '@/utils/service-manager/index';

export const options = zod.object({});

type Props = {
	options: zod.infer<typeof options>;
};

async function runGatewayStop(): Promise<void> {
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
		// Clean up preferences if needed
		const prefs = getPreferences();
		if (prefs.gateway?.serviceInstalled) {
			const { gateway, ...rest } = prefs;
			updatePreferences(rest);
		}

		spinner.stop(chalk.yellow('Gateway is not running'));
		return;
	}

	// Stop if running
	const serviceStatus = await getServiceStatus(serviceName);
	if (serviceStatus === 'running') {
		spinner.message('Stopping gateway...');
		try {
			await stopService(serviceName);
			await new Promise((resolve) => setTimeout(resolve, 1000));
		} catch {
			// Continue anyway
		}
	}

	// Uninstall the service
	spinner.message('Removing service...');
	await uninstallService(serviceName);

	// Clean up preferences
	const prefs = getPreferences();
	const { gateway, ...rest } = prefs;
	updatePreferences(rest);

	spinner.stop(chalk.green('Gateway stopped'));

	p.note(
		[
			'The gateway has been stopped and removed.',
			'To start again: corebrain gateway start',
		].join('\n'),
		'Gateway Stopped'
	);
}

export default function GatewayStop(_props: Props) {
	const { exit } = useApp();

	useEffect(() => {
		runGatewayStop()
			.catch((err) => {
				p.log.error(`Failed to stop gateway: ${err instanceof Error ? err.message : 'Unknown error'}`);
			})
			.finally(() => {
				setTimeout(() => exit(), 100);
			});
	}, [exit]);

	return null;
}
