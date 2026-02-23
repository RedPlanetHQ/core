import { useEffect } from 'react';
import { useApp } from 'ink';
import * as p from '@clack/prompts';
import chalk from 'chalk';
import zod from 'zod';
import { browserClose, isBrowserUseInstalled } from '@/utils/browser-use';

export const args = zod.tuple([zod.string().describe('Session name to delete')]);

export const options = zod.object({});

type Props = {
	args: zod.infer<typeof args>;
	options: zod.infer<typeof options>;
};

async function runDeleteSession(name: string): Promise<void> {
	const spinner = p.spinner();
	spinner.start('Checking browser-use...');

	const installed = await isBrowserUseInstalled();

	if (!installed) {
		spinner.stop(chalk.red('Not installed'));
		p.log.error('browser-use is not installed. Run `corebrain browser install` first.');
		return;
	}

	spinner.message(`Closing and removing session "${name}"...`);

	// browser-use manages session cleanup when closing
	const result = await browserClose(name);

	if (result.code !== 0) {
		spinner.stop(chalk.red('Failed to delete session'));
		p.log.error(result.stderr || 'Failed to delete session');
		return;
	}

	spinner.stop(chalk.green(`Session "${name}" deleted`));
}

export default function BrowserDeleteSession({ args: [name] }: Props) {
	const { exit } = useApp();

	useEffect(() => {
		runDeleteSession(name)
			.catch((err) => {
				p.log.error(`Failed to delete session: ${err instanceof Error ? err.message : 'Unknown error'}`);
			})
			.finally(() => {
				setTimeout(() => exit(), 100);
			});
	}, [name, exit]);

	return null;
}
