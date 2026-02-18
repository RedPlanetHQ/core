import {useEffect} from 'react';
import {useApp} from 'ink';
import * as p from '@clack/prompts';
import chalk from 'chalk';
import zod from 'zod';
import {executeCodingTool} from '@/server/tools/coding-tools';
import {listSessions} from '@/utils/coding-sessions';

export const options = zod.object({
	sessionId: zod.string().optional().describe('Session ID to close'),
	all: zod.boolean().optional().describe('Close all sessions'),
});

type Props = {
	options: zod.infer<typeof options>;
};

async function runCloseSession(opts: zod.infer<typeof options>): Promise<void> {
	if (opts.all) {
		const sessions = listSessions();
		if (sessions.length === 0) {
			p.log.info('No sessions to close.');
			return;
		}

		const confirmed = await p.confirm({
			message: `Close all ${sessions.length} sessions?`,
		});
		if (p.isCancel(confirmed) || !confirmed) {
			p.cancel('Cancelled');
			return;
		}

		const spinner = p.spinner();
		spinner.start('Closing all sessions...');

		let closed = 0;
		for (const s of sessions) {
			const result = await executeCodingTool('coding_close_session', {
				sessionId: s.sessionId,
			});
			if (result.success) closed++;
		}

		spinner.stop(chalk.green(`Closed ${closed} sessions`));
		return;
	}

	// Get session ID
	let sessionId = opts.sessionId;
	if (!sessionId) {
		const sessions = listSessions();
		if (sessions.length === 0) {
			p.log.error('No sessions found.');
			return;
		}

		const selected = await p.select({
			message: 'Select session to close',
			options: sessions.map((s) => ({
				value: s.sessionId,
				label: `${s.sessionId.slice(0, 8)}... (${s.agent}) - ${s.status}`,
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

	const result = await executeCodingTool('coding_close_session', {
		sessionId,
	});

	if (!result.success) {
		spinner.stop(chalk.red('Failed'));
		p.log.error(result.error || 'Unknown error');
		return;
	}

	spinner.stop(chalk.green('Closed'));

	const res = result.result as {
		sessionId: string;
		wasRunning: boolean;
		message: string;
	};
	p.log.success(
		`Session ${res.sessionId.slice(0, 8)}... closed${res.wasRunning ? ' (was running)' : ''}`,
	);
}

export default function CodingClose({options: opts}: Props) {
	const {exit} = useApp();

	useEffect(() => {
		runCloseSession(opts)
			.catch((err) => {
				p.log.error(err instanceof Error ? err.message : 'Unknown error');
			})
			.finally(() => {
				setTimeout(() => exit(), 100);
			});
	}, [opts, exit]);

	return null;
}
