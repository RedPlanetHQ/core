import {useEffect} from 'react';
import {useApp} from 'ink';
import * as p from '@clack/prompts';
import chalk from 'chalk';
import zod from 'zod';
import {executeCodingTool} from '@/server/tools/coding-tools';
import {listSessions} from '@/utils/coding-sessions';

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

interface SessionReadResult {
	sessionId: string;
	agent: string;
	prompt: string;
	dir: string;
	status: string;
	running: boolean;
	output: string;
	error?: string;
	exitCode: number | null;
	totalLines: number;
	returnedLines: number;
}

async function runReadSession(opts: zod.infer<typeof options>): Promise<void> {
	// Get session ID
	let sessionId = opts.sessionId;
	if (!sessionId) {
		const sessions = listSessions();
		if (sessions.length === 0) {
			p.log.error('No sessions found.');
			return;
		}

		const selected = await p.select({
			message: 'Select session',
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
		// Follow mode - continuously poll
		p.log.info(`Following session ${sessionId}... (Ctrl+C to stop)`);
		let lastOutput = '';

		const poll = async () => {
			const res = await readOnce();
			if (!res) return false;

			// Only print new output
			if (res.output !== lastOutput) {
				const newContent = res.output.slice(lastOutput.length);
				if (newContent) {
					process.stdout.write(newContent);
				}
				lastOutput = res.output;
			}

			return res.running;
		};

		let running = true;
		while (running) {
			running = await poll();
			if (running) {
				await new Promise((resolve) => setTimeout(resolve, 500));
			}
		}

		p.log.info('\nSession completed.');
		return;
	}

	// Single read
	const res = await readOnce();
	if (!res) return;

	const statusColor =
		res.status === 'running'
			? chalk.blue
			: res.status === 'completed'
				? chalk.green
				: chalk.red;

	console.log(
		chalk.dim(
			`--- Session ${res.sessionId.slice(0, 8)} | ${res.agent} | ${statusColor(res.status)} ---`,
		),
	);
	console.log(
		chalk.dim(
			`Lines: ${res.returnedLines}/${res.totalLines} | Dir: ${res.dir}`,
		),
	);
	console.log();

	if (res.output) {
		console.log(res.output);
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
			.catch((err) => {
				p.log.error(err instanceof Error ? err.message : 'Unknown error');
			})
			.finally(() => {
				setTimeout(() => exit(), 100);
			});
	}, [opts, exit]);

	return null;
}
