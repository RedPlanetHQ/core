import { useEffect } from 'react';
import { useApp } from 'ink';
import * as p from '@clack/prompts';
import chalk from 'chalk';
import zod from 'zod';
import { isAgentBrowserInstalled, installAgentBrowser } from '@/utils/agent-browser';

export const options = zod.object({});

type Props = {
	options: zod.infer<typeof options>;
};

async function runBrowserInstall(): Promise<void> {
	const spinner = p.spinner();
	spinner.start('Checking if agent-browser is installed...');

	const installed = await isAgentBrowserInstalled();

	if (installed) {
		spinner.stop(chalk.green('agent-browser is already installed'));
		return;
	}

	spinner.message('Installing agent-browser globally via npm...');

	const result = await installAgentBrowser();

	if (result.code !== 0) {
		spinner.stop(chalk.red('Installation failed'));
		p.log.error(result.stderr || 'Installation failed');
		return;
	}

	spinner.stop(chalk.green('agent-browser installed successfully'));
}

export default function BrowserInstall(_props: Props) {
	const { exit } = useApp();

	useEffect(() => {
		runBrowserInstall()
			.catch((err) => {
				p.log.error(`Failed to install agent-browser: ${err instanceof Error ? err.message : 'Unknown error'}`);
			})
			.finally(() => {
				setTimeout(() => exit(), 100);
			});
	}, [exit]);

	return null;
}
