import {useEffect} from 'react';
import {useApp} from 'ink';
import * as p from '@clack/prompts';
import chalk from 'chalk';
import zod from 'zod';
import {executeCodingTool} from '@/server/tools/coding-tools';

export const options = zod.object({
	agent: zod.string().optional().describe('Filter to a specific agent (e.g. claude-code, codex-cli)'),
	since: zod.string().optional().describe('Filter sessions updated after this date (e.g. 2024-03-01)'),
	dir: zod.string().optional().describe('Filter to a specific directory'),
	offset: zod.number().optional().describe('Skip N sessions (for pagination)'),
	json: zod.boolean().optional().describe('Output as JSON'),
});

type Props = {
	options: zod.infer<typeof options>;
};

interface SessionInfo {
	sessionId: string;
	agent: string;
	dir: string;
	title: string | null;
	running: boolean;
	createdAt: string;
	updatedAt: string;
	fileSizeBytes: number;
}

async function runListSessions(opts: zod.infer<typeof options>): Promise<void> {
	const result = await executeCodingTool('coding_list_sessions', {
		agent: opts.agent,
		since: opts.since,
		dir: opts.dir,
		offset: opts.offset,
	});

	if (!result.success) {
		p.log.error(result.error || 'Unknown error');
		return;
	}

	const res = result.result as {sessions: SessionInfo[]; total: number; hasMore: boolean; offset: number};

	if (opts.json) {
		console.log(JSON.stringify(res, null, 2));
		return;
	}

	if (res.sessions.length === 0) {
		p.log.info('No sessions found.');
		p.log.info('Start one via the API: POST /api/coding/coding_ask');
		return;
	}

	const lines = res.sessions.map((s) => {
		const status = s.running ? chalk.blue('running') : chalk.dim(s.updatedAt.slice(0, 10));
		const title = s.title ? chalk.white(s.title.slice(0, 55)) : chalk.dim('(no title)');
		return [chalk.bold(s.sessionId.slice(0, 8)), chalk.cyan(s.agent), title, status, chalk.dim(s.dir)].join('  ');
	});

	const pagination = res.hasMore ? ` — showing ${res.offset + 1}–${res.offset + res.sessions.length} of ${res.total}` : '';
	p.note(lines.join('\n'), `Sessions (${res.total})${pagination}`);
}

export default function CodingList({options: opts}: Props) {
	const {exit} = useApp();

	useEffect(() => {
		runListSessions(opts)
			.catch((err) => p.log.error(err instanceof Error ? err.message : 'Unknown error'))
			.finally(() => setTimeout(() => exit(), 100));
	}, [opts, exit]);

	return null;
}
