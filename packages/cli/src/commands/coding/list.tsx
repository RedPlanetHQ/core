import {useEffect} from 'react';
import {useApp} from 'ink';
import * as p from '@clack/prompts';
import chalk from 'chalk';
import zod from 'zod';
import {executeCodingTool} from '@/server/tools/coding-tools';

export const options = zod.object({
	json: zod.boolean().optional().describe('Output as JSON'),
});

type Props = {
	options: zod.infer<typeof options>;
};

interface SessionInfo {
	sessionId: string;
	agent: string;
	dir: string;
	status: string;
	running: boolean;
	startedAt: number;
	updatedAt: number;
}

function formatTime(timestamp: number): string {
	const date = new Date(timestamp);
	const now = new Date();
	const diffMs = now.getTime() - date.getTime();
	const diffMins = Math.floor(diffMs / 60000);
	const diffHours = Math.floor(diffMins / 60);
	const diffDays = Math.floor(diffHours / 24);

	if (diffDays > 0) return `${diffDays}d ago`;
	if (diffHours > 0) return `${diffHours}h ago`;
	if (diffMins > 0) return `${diffMins}m ago`;
	return 'just now';
}

async function runListSessions(opts: zod.infer<typeof options>): Promise<void> {
	const result = await executeCodingTool('coding_list_sessions', {});

	if (!result.success) {
		p.log.error(result.error || 'Unknown error');
		return;
	}

	const res = result.result as {sessions: SessionInfo[]; count: number};

	if (opts.json) {
		console.log(JSON.stringify(res, null, 2));
		return;
	}

	if (res.count === 0) {
		p.log.info('No sessions found.');
		p.log.info("Start one with: corebrain coding start");
		return;
	}

	const lines = res.sessions.map((s) => {
		const statusColor =
			s.status === 'running'
				? chalk.blue
				: s.status === 'completed'
					? chalk.green
					: s.status === 'closed'
						? chalk.gray
						: chalk.red;

		return [
			`${chalk.bold(s.sessionId.slice(0, 8))}`,
			chalk.cyan(s.agent),
			statusColor(s.status),
			chalk.dim(s.dir),
			chalk.dim(formatTime(s.startedAt)),
		].join('  ');
	});

	p.note(lines.join('\n'), `Sessions (${res.count})`);
}

export default function CodingList({options: opts}: Props) {
	const {exit} = useApp();

	useEffect(() => {
		runListSessions(opts)
			.catch((err) => {
				p.log.error(err instanceof Error ? err.message : 'Unknown error');
			})
			.finally(() => {
				setTimeout(() => exit(), 100);
			});
	}, [opts, exit]);

	return null;
}
