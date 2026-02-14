import { useEffect } from 'react';
import { useApp } from 'ink';
import * as p from '@clack/prompts';
import chalk from 'chalk';
import zod from 'zod';
import { isAgentBrowserInstalled, browserOpen, canCreateSession, getSession } from '@/utils/agent-browser';

export const args = zod.tuple([
	zod.string().describe('Session name'),
	zod.string().describe('URL to open'),
]);

export const options = zod.object({
	profile: zod.string().optional().default('corebrain').describe('Browser profile to use (default: corebrain)'),
});

type Props = {
	args: zod.infer<typeof args>;
	options: zod.infer<typeof options>;
};

async function runBrowserOpen(sessionName: string, url: string, profile: string): Promise<void> {
	const spinner = p.spinner();
	spinner.start('Checking agent-browser...');

	const installed = await isAgentBrowserInstalled();

	if (!installed) {
		spinner.stop(chalk.red('Not installed'));
		p.log.error('agent-browser is not installed. Run `corebrain browser install` first.');
		return;
	}

	// Check session limit
	const { allowed, count } = canCreateSession();
	const existingSession = getSession(sessionName);

	if (!existingSession && !allowed) {
		spinner.stop(chalk.red('Session limit reached'));
		p.log.error(`Maximum 3 sessions allowed. Currently running: ${count}. Close a session first.`);
		return;
	}

	spinner.message(`Opening ${url} in session "${sessionName}"...`);

	const result = await browserOpen(sessionName, url, profile);

	if (result.code !== 0) {
		spinner.stop(chalk.red('Failed to open URL'));
		p.log.error(result.stderr || 'Failed to open URL');
		return;
	}

	spinner.stop(chalk.green(`Opened ${url} in session "${sessionName}" (profile: ${profile})`));
}

export default function BrowserOpen({ args: [sessionName, url], options }: Props) {
	const { exit } = useApp();

	useEffect(() => {
		runBrowserOpen(sessionName, url, options.profile)
			.catch((err) => {
				p.log.error(`Failed to open URL: ${err instanceof Error ? err.message : 'Unknown error'}`);
			})
			.finally(() => {
				setTimeout(() => exit(), 100);
			});
	}, [sessionName, url, options.profile, exit]);

	return null;
}
