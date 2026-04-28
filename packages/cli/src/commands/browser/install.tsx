import {useEffect} from 'react';
import {useApp} from 'ink';
import * as p from '@clack/prompts';
import chalk from 'chalk';
import zod from 'zod';
import {
	isPlaywrightReady,
	installPlaywrightChromium,
	getPlaywrightVersion,
	getConfiguredProfiles,
	getMaxProfiles,
} from '@/utils/browser-config';

import {requireNativeGateway} from "@/utils/require-native-gateway";

export const options = zod.object({});

type Props = {
	options: zod.infer<typeof options>;
};

async function runBrowserInstall(): Promise<void> {
	if (!requireNativeGateway()) return;
	const spinner = p.spinner();
	spinner.start('Checking if Playwright Chromium is installed...');

	const ready = await isPlaywrightReady();

	if (ready) {
		spinner.stop(chalk.green('Playwright Chromium is already installed'));

		const versionSpinner = p.spinner();
		versionSpinner.start('Checking version...');
		const versionResult = await getPlaywrightVersion();

		if (versionResult.code === 0) {
			versionSpinner.stop(chalk.green('Installation validated'));
			if (versionResult.stdout) {
				console.log(versionResult.stdout.trim());
			}
		} else {
			versionSpinner.stop(chalk.yellow('Could not verify version'));
		}

		const profiles = getConfiguredProfiles();
		const maxProfiles = getMaxProfiles();
		if (profiles.length > 0) {
			p.log.info(`Configured profiles (${profiles.length}/${maxProfiles}): ${profiles.join(', ')}`);
		} else {
			p.log.info('No profiles. Run `corebrain browser create-profile <name>` to create one.');
		}

		return;
	}

	spinner.message('Installing Playwright Chromium...');

	const result = await installPlaywrightChromium();

	if (result.code !== 0) {
		spinner.stop(chalk.red('Installation failed'));
		p.log.error(result.stderr || 'Installation failed');
		return;
	}

	spinner.stop(chalk.green('Playwright Chromium installed successfully'));

	const profiles = getConfiguredProfiles();
	const maxProfiles = getMaxProfiles();
	p.log.info(`Default profiles created (${profiles.length}/${maxProfiles}): ${profiles.join(', ')}`);
}

export default function BrowserInstall(_props: Props) {
	const {exit} = useApp();

	useEffect(() => {
		runBrowserInstall()
			.catch(err => {
				p.log.error(
					`Failed to install Playwright: ${
						err instanceof Error ? err.message : 'Unknown error'
					}`,
				);
			})
			.finally(() => {
				setTimeout(() => exit(), 100);
			});
	}, [exit]);

	return null;
}
