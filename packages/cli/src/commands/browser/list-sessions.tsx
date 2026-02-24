import {useEffect} from 'react';
import {useApp} from 'ink';
import * as p from '@clack/prompts';
import chalk from 'chalk';
import zod from 'zod';
import {browserGetSessions, getMaxSessions} from '@/utils/agent-browser';

export const options = zod.object({});

type Props = {
	options: zod.infer<typeof options>;
};

async function runListSessions(): Promise<void> {
	const sessions = browserGetSessions();
	const maxSessions = getMaxSessions();

	if (sessions.length === 0) {
		p.log.info('No sessions configured.');
		p.log.info('Run `corebrain browser create-session <name>` to create a session.');
		return;
	}

	const lines: string[] = [
		`${chalk.bold('Configured Sessions:')} ${chalk.green(`${sessions.length}/${maxSessions}`)}`,
		'',
	];

	for (const session of sessions) {
		lines.push(`  ${chalk.dim('•')} ${chalk.cyan(session)}`);
	}

	p.note(lines.join('\n'), 'Browser Sessions');
}

export default function BrowserListSessions(_props: Props) {
	const {exit} = useApp();

	useEffect(() => {
		runListSessions()
			.catch(err => {
				p.log.error(err instanceof Error ? err.message : 'Unknown error');
			})
			.finally(() => {
				setTimeout(() => exit(), 100);
			});
	}, [exit]);

	return null;
}
