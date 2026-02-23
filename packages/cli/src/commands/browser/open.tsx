import {useEffect} from 'react';
import {useApp} from 'ink';
import * as p from '@clack/prompts';
import chalk from 'chalk';
import zod from 'zod';
import {isBrowserUseInstalled, browserOpen} from '@/utils/browser-use';

export const args = zod.tuple([zod.string().describe('URL to open')]);

export const options = zod.object({
	sessionName: zod
		.string()
		.optional()
		.default('default')
		.describe('Session name for persistence (default: default)'),
});

type Props = {
	args: zod.infer<typeof args>;
	options: zod.infer<typeof options>;
};

async function runBrowserOpen(url: string, sessionName: string): Promise<void> {
	const spinner = p.spinner();
	spinner.start('Checking browser-use...');

	const installed = await isBrowserUseInstalled();

	if (!installed) {
		spinner.stop(chalk.red('Not installed'));
		p.log.error(
			'browser-use is not installed. Run `corebrain browser install` first.',
		);
		return;
	}

	spinner.message(`Opening ${url} with session "${sessionName}"...`);

	const result = await browserOpen(url, sessionName);

	if (result.code !== 0) {
		spinner.stop(chalk.red('Failed to open URL'));
		p.log.error(result.stderr || 'Failed to open URL');
		return;
	}

	spinner.stop(chalk.green(`Opened ${url} (session: ${sessionName})`));
}

export default function BrowserOpen({args: [url], options}: Props) {
	const {exit} = useApp();

	useEffect(() => {
		runBrowserOpen(url, options.sessionName)
			.catch(err => {
				p.log.error(
					`Failed to open URL: ${
						err instanceof Error ? err.message : 'Unknown error'
					}`,
				);
			})
			.finally(() => {
				setTimeout(() => exit(), 100);
			});
	}, [url, options.sessionName, exit]);

	return null;
}
