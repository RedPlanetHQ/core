import {useEffect} from 'react';
import {useApp} from 'ink';
import * as p from '@clack/prompts';
import chalk from 'chalk';
import zod from 'zod';
import {executeCodingTool} from '@/server/tools/coding-tools';
import {listRunningSessions} from '@/utils/coding-sessions';

export const options = zod.object({
	sessionId: zod.string().optional().describe('Session ID to close'),
	all: zod.boolean().optional().describe('Close all running sessions'),
});

type Props = {
	options: zod.infer<typeof options>;
};

async function runCloseSession(opts: zod.infer<typeof options>): Promise<void> {
	if (opts.all) {
		const sessions = listRunningSessions();
		if (sessions.length === 0) {
			p.log.info('No running sessions.');
			return;
		}

		const confirmed = await p.confirm({message: `Close all ${sessions.length} running sessions?`});
		if (p.isCancel(confirmed) || !confirmed) {
			p.cancel('Cancelled');
			return;
		}

		const spinner = p.spinner();
		spinner.start('Closing all sessions...');

		let closed = 0;
		for (const s of sessions) {
			const result = await executeCodingTool('coding_close_session', {sessionId: s.sessionId});
			if (result.success) closed++;
		}

		spinner.stop(chalk.green(`Closed ${closed} sessions`));
		return;
	}

	let sessionId = opts.sessionId;
	if (!sessionId) {
		const sessions = listRunningSessions();
		if (sessions.length === 0) {
			p.log.error('No running sessions found.');
			return;
		}

		const selected = await p.select({
			message: 'Select session to close',
			options: sessions.map((s) => ({
				value: s.sessionId,
				label: `${s.sessionId.slice(0, 8)}... (${s.agent}) ${chalk.blue('running')}`,
			})),
		});
		if (p.isCancel(selected)) {
			p.cancel('Cancelled');
			return;
		}
		sessionId = selected as string;
	}

	const spinner = p.spinner();
	spinner.start('Closing session...');

	const result = await executeCodingTool('coding_close_session', {sessionId});

	if (!result.success) {
		spinner.stop(chalk.red('Failed'));
		p.log.error(result.error || 'Unknown error');
		return;
	}

	spinner.stop(chalk.green('Closed'));
	p.log.success(`Session ${sessionId.slice(0, 8)}... closed`);
}

export default function CodingClose({options: opts}: Props) {
	const {exit} = useApp();

	useEffect(() => {
		runCloseSession(opts)
			.catch((err) => p.log.error(err instanceof Error ? err.message : 'Unknown error'))
			.finally(() => setTimeout(() => exit(), 100));
	}, [opts, exit]);

	return null;
}
