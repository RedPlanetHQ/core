import {useEffect} from 'react';
import {useApp} from 'ink';
import * as p from '@clack/prompts';
import chalk from 'chalk';
import zod from 'zod';
import {executeCodingTool} from '@/server/tools/coding-tools';

export const options = zod.object({
	sessionId: zod.string().optional().describe('Session ID to read'),
	lines: zod.number().optional().describe('Number of lines to return'),
	offset: zod.number().optional().describe('Line offset to start from'),
	tail: zod.boolean().optional().describe('Return last N lines'),
	follow: zod.boolean().optional().describe('Follow output (like tail -f)'),
});

type Props = {
	options: zod.infer<typeof options>;
};

interface SessionEntry {
	type: string;
	message?: {role: string; content: string | Array<{type: string; text?: string}>};
	timestamp?: string;
	[key: string]: unknown;
}

interface SessionListItem {
	sessionId: string;
	dir: string;
	title: string | null;
	running: boolean;
	updatedAt: string;
}

interface SessionReadResult {
	sessionId: string;
	dir: string;
	status: string;
	running: boolean;
	entries: SessionEntry[];
	error?: string;
	totalLines: number;
	returnedLines: number;
	fileSizeBytes: number;
	fileSizeHuman: string;
}

async function runReadSession(opts: zod.infer<typeof options>): Promise<void> {
	let sessionId = opts.sessionId;

	if (!sessionId) {
		const listResult = await executeCodingTool('coding_list_sessions', {limit: 20});
		if (!listResult.success) {
			p.log.error(listResult.error || 'Failed to list sessions');
			return;
		}

		const {sessions} = listResult.result as {sessions: SessionListItem[]};
		if (sessions.length === 0) {
			p.log.error('No sessions found.');
			return;
		}

		const selected = await p.select({
			message: 'Select session',
			options: sessions.map((s) => ({
				value: s.sessionId,
				label: [
					chalk.bold(s.sessionId.slice(0, 8)),
					s.title ? chalk.white(s.title.slice(0, 50)) : chalk.dim('(no title)'),
					s.running ? chalk.blue('running') : chalk.dim(s.updatedAt.slice(0, 10)),
				].join('  '),
			})),
		});
		if (p.isCancel(selected)) {
			p.cancel('Cancelled');
			return;
		}

		sessionId = selected as string;
	}

	const readOnce = async (): Promise<SessionReadResult | null> => {
		const result = await executeCodingTool('coding_read_session', {
			sessionId,
			lines: opts.lines,
			offset: opts.offset,
			tail: opts.tail,
		});

		if (!result.success) {
			p.log.error(result.error || 'Unknown error');
			return null;
		}

		return result.result as SessionReadResult;
	};

	if (opts.follow) {
		p.log.info(`Following session ${sessionId}... (Ctrl+C to stop)`);
		let lastEntryCount = 0;

		let running = true;
		while (running) {
			const res = await readOnce();
			if (!res) break;

			if (res.entries.length > lastEntryCount) {
				for (const entry of res.entries.slice(lastEntryCount)) {
					console.log(JSON.stringify(entry));
				}
				lastEntryCount = res.entries.length;
			}

			running = res.running;
			if (running) await new Promise((resolve) => setTimeout(resolve, 500));
		}

		p.log.info('Session completed.');
		return;
	}

	const res = await readOnce();
	if (!res) return;

	const statusColor = res.status === 'running' ? chalk.blue : res.status === 'completed' ? chalk.green : chalk.red;

	console.log(chalk.dim(`--- Session ${res.sessionId.slice(0, 8)} | ${statusColor(res.status)} ---`));
	console.log(chalk.dim(`Lines: ${res.returnedLines}/${res.totalLines} | Size: ${res.fileSizeHuman} | Dir: ${res.dir}`));
	console.log();

	for (const entry of res.entries) {
		console.log(JSON.stringify(entry));
	}

	if (res.error) {
		console.log(chalk.red('\n--- Errors ---'));
		console.log(res.error);
	}
}

export default function CodingRead({options: opts}: Props) {
	const {exit} = useApp();

	useEffect(() => {
		runReadSession(opts)
			.catch((err) => p.log.error(err instanceof Error ? err.message : 'Unknown error'))
			.finally(() => setTimeout(() => exit(), 100));
	}, [opts, exit]);

	return null;
}
