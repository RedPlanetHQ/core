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

async function runGatewayUninstall(): Promise<void> {
	const spinner = p.spinner();

	const serviceType = getServiceType();

	if (serviceType === 'none') {
		p.log.error('Service management not supported on this platform.');
		return;
	}

	spinner.start('Checking service...');

	const serviceName = getServiceName();
	const installed = await isServiceInstalled(serviceName);

	if (!installed) {
		// Clean up preferences if needed
		const prefs = getPreferences();
		if (prefs.gateway?.serviceInstalled) {
			const { gateway, ...rest } = prefs;
			updatePreferences(rest);
		}

		spinner.stop(chalk.yellow('Not installed'));
		p.log.warning('Gateway is not installed');
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

	// Uninstall
	spinner.message('Removing service...');
	await uninstallService(serviceName);

	// Clean up preferences
	const prefs = getPreferences();
	const { gateway, ...rest } = prefs;
	updatePreferences(rest);

	spinner.stop(chalk.green('Gateway service removed'));

	p.note(
		[
			'The gateway will no longer auto-start.',
			'To reinstall: corebrain gateway on',
		].join('\n'),
		'Gateway Uninstalled'
	);
}

export default function GatewayUninstall(_props: Props) {
	const { exit } = useApp();

	useEffect(() => {
		runGatewayUninstall()
			.catch((err) => {
				p.log.error(`Failed to uninstall: ${err instanceof Error ? err.message : 'Unknown error'}`);
			})
			.finally(() => {
				setTimeout(() => exit(), 100);
			});
	}, [exit]);

	return null;
}
