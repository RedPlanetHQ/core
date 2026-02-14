import { useEffect } from 'react';
import { useApp } from 'ink';
import * as p from '@clack/prompts';
import chalk from 'chalk';
import zod from 'zod';
import { isAgentBrowserInstalled, browserClose, getSession } from '@/utils/agent-browser';

export const args = zod.tuple([
	zod.string().describe('Session name to close'),
]);

export const options = zod.object({});

type Props = {
	args: zod.infer<typeof args>;
	options: zod.infer<typeof options>;
};

async function runBrowserClose(sessionName: string): Promise<void> {
	const spinner = p.spinner();
	spinner.start('Checking agent-browser...');

	const installed = await isAgentBrowserInstalled();

	if (!installed) {
		spinner.stop(chalk.red('Not installed'));
		p.log.error('agent-browser is not installed. Run `corebrain browser install` first.');
		return;
	}

	// Check if session exists
	const session = getSession(sessionName);
	if (!session) {
		spinner.stop(chalk.yellow('Session not found'));
		p.log.warning(`Session "${sessionName}" not found. Use \`corebrain browser status\` to see active sessions.`);
		return;
	}

	spinner.message(`Closing session "${sessionName}"...`);

	const result = await browserClose(sessionName);

	if (result.code !== 0) {
		spinner.stop(chalk.red('Failed to close browser'));
		p.log.error(result.stderr || 'Failed to close browser');
		return;
	}

	spinner.stop(chalk.green(`Closed session "${sessionName}"`));
}

export default function BrowserClose({ args: [sessionName] }: Props) {
	const { exit } = useApp();

	useEffect(() => {
		runBrowserClose(sessionName)
			.catch((err) => {
				p.log.error(`Failed to close browser: ${err instanceof Error ? err.message : 'Unknown error'}`);
			})
			.finally(() => {
				setTimeout(() => exit(), 100);
			});
	}, [sessionName, exit]);

	return null;
}
