import { useEffect } from 'react';
import { useApp } from 'ink';
import * as p from '@clack/prompts';
import chalk from 'chalk';
import zod from 'zod';
import { isBrowserUseInstalled, browserClose, browserCloseAll } from '@/utils/browser-use';

export const options = zod.object({
	sessionName: zod.string().optional().describe('Session name to close'),
	all: zod.boolean().optional().default(false).describe('Close all sessions'),
});

type Props = {
	options: zod.infer<typeof options>;
};

async function runBrowserClose(sessionName: string | undefined, closeAll: boolean): Promise<void> {
	const spinner = p.spinner();
	spinner.start('Checking browser-use...');

	const installed = await isBrowserUseInstalled();

	if (!installed) {
		spinner.stop(chalk.red('Not installed'));
		p.log.error('browser-use is not installed. Run `corebrain browser install` first.');
		return;
	}

	if (closeAll) {
		spinner.message('Closing all browser sessions...');
		const result = await browserCloseAll();

		if (result.code !== 0) {
			spinner.stop(chalk.red('Failed to close all browsers'));
			p.log.error(result.stderr || 'Failed to close all browsers');
			return;
		}

		spinner.stop(chalk.green('Closed all browser sessions'));
		return;
	}

	const session = sessionName || 'default';
	spinner.message(`Closing browser for session "${session}"...`);

	const result = await browserClose(session);

	if (result.code !== 0) {
		spinner.stop(chalk.red('Failed to close browser'));
		p.log.error(result.stderr || 'Failed to close browser');
		return;
	}

	spinner.stop(chalk.green(`Closed browser for session "${session}"`));
}

export default function BrowserClose({ options }: Props) {
	const { exit } = useApp();

	useEffect(() => {
		runBrowserClose(options.sessionName, options.all)
			.catch((err) => {
				p.log.error(`Failed to close browser: ${err instanceof Error ? err.message : 'Unknown error'}`);
			})
			.finally(() => {
				setTimeout(() => exit(), 100);
			});
	}, [options.sessionName, options.all, exit]);

	return null;
}
