import {useEffect} from 'react';
import {useApp} from 'ink';
import * as p from '@clack/prompts';
import chalk from 'chalk';
import zod from 'zod';
import {deleteSession, getConfiguredSessions, getMaxSessions, isAgentBrowserInstalled, browserClose} from '@/utils/agent-browser';

export const args = zod.tuple([zod.string().describe('Session name to delete')]);

export const options = zod.object({});

type Props = {
	args: zod.infer<typeof args>;
	options: zod.infer<typeof options>;
};

async function runDeleteSession(name: string): Promise<void> {
	const spinner = p.spinner();
	spinner.start(`Deleting session "${name}"...`);

	// First close the browser if it's running
	const installed = await isAgentBrowserInstalled();
	if (installed) {
		await browserClose(name);
	}

	// Then remove from config
	const result = deleteSession(name);

	if (!result.success) {
		spinner.stop(chalk.red('Failed'));
		p.log.error(result.error || 'Failed to delete session');
		return;
	}

	spinner.stop(chalk.green(`Session "${name}" deleted`));

	const sessions = getConfiguredSessions();
	const maxSessions = getMaxSessions();
	if (sessions.length > 0) {
		p.log.info(`Remaining sessions: ${sessions.join(', ')} (${sessions.length}/${maxSessions})`);
	} else {
		p.log.info('No sessions configured. Create one with: corebrain browser create-session <name>');
	}
}

export default function BrowserDeleteSession({args: [name]}: Props) {
	const {exit} = useApp();

	useEffect(() => {
		runDeleteSession(name)
			.catch(err => {
				p.log.error(
					`Failed to delete session: ${
						err instanceof Error ? err.message : 'Unknown error'
					}`,
				);
			})
			.finally(() => {
				setTimeout(() => exit(), 100);
			});
	}, [name, exit]);

	return null;
}
