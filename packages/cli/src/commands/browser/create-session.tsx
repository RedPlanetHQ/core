import {useEffect} from 'react';
import {useApp} from 'ink';
import * as p from '@clack/prompts';
import chalk from 'chalk';
import zod from 'zod';
import {createSession, getMaxSessions, getConfiguredSessions} from '@/utils/agent-browser';

export const args = zod.tuple([zod.string().describe('Session name to create')]);

export const options = zod.object({});

type Props = {
	args: zod.infer<typeof args>;
	options: zod.infer<typeof options>;
};

async function runCreateSession(name: string): Promise<void> {
	const spinner = p.spinner();
	spinner.start(`Creating session "${name}"...`);

	const result = createSession(name);

	if (!result.success) {
		spinner.stop(chalk.red('Failed'));
		p.log.error(result.error || 'Failed to create session');
		return;
	}

	spinner.stop(chalk.green(`Session "${name}" created`));

	const sessions = getConfiguredSessions();
	const maxSessions = getMaxSessions();
	p.log.info(`Sessions: ${sessions.join(', ')} (${sessions.length}/${maxSessions})`);
}

export default function BrowserCreateSession({args: [name]}: Props) {
	const {exit} = useApp();

	useEffect(() => {
		runCreateSession(name)
			.catch(err => {
				p.log.error(
					`Failed to create session: ${
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
