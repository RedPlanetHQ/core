import {useEffect} from 'react';
import {useApp} from 'ink';
import * as p from '@clack/prompts';
import chalk from 'chalk';
import zod from 'zod';
import {getConfiguredSessions, getMaxSessions} from '@/utils/browser-config';
import {getLiveSessions} from '@/utils/browser-manager';

export const options = zod.object({});

type Props = {
	options: zod.infer<typeof options>;
};

async function runListSessions(): Promise<void> {
	const sessions = getConfiguredSessions();
	const maxSessions = getMaxSessions();
	const live = getLiveSessions();

	if (sessions.length === 0) {
		p.log.info('No sessions configured.');
		p.log.info('Run: corebrain browser create-session <name> --profile <profile>');
		return;
	}

	const lines: string[] = [
		`${chalk.bold('Sessions:')} ${chalk.green(`${sessions.length}/${maxSessions}`)}`,
		'',
	];

	for (const session of sessions) {
		const isLive = live.includes(session.name);
		lines.push(
			`  ${chalk.dim('•')} ${chalk.cyan(session.name)} ${chalk.dim(`profile: ${session.profile}`)}${
				isLive ? chalk.green(' [live]') : ''
			}`,
		);
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
