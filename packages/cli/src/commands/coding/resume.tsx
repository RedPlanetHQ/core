import {useEffect} from 'react';
import {useApp} from 'ink';
import * as p from '@clack/prompts';
import chalk from 'chalk';
import zod from 'zod';
import {executeCodingTool} from '@/server/tools/coding-tools';
export const options = zod.object({
	sessionId: zod.string().optional().describe('Session ID to continue'),
	prompt: zod.string().optional().describe('Follow-up prompt'),
	dir: zod.string().optional().describe('Working directory (required if sessionId provided)'),
});

type Props = {
	options: zod.infer<typeof options>;
};

interface SessionListItem {
	sessionId: string;
	agent: string;
	dir: string;
	title: string | null;
	running: boolean;
	updatedAt: string;
}

async function runResumeSession(opts: zod.infer<typeof options>): Promise<void> {
	let sessionId = opts.sessionId;
	let dir = opts.dir;
	let agent: string | undefined;

	if (!sessionId) {
		// List sessions from JSONL history
		const listResult = await executeCodingTool('coding_list_sessions', {limit: 20});
		if (!listResult.success) {
			p.log.error(listResult.error || 'Failed to list sessions');
			return;
		}

		const {sessions} = listResult.result as {sessions: SessionListItem[]};
		if (sessions.length === 0) {
			p.log.error('No sessions found. Start one with: corebrain coding start');
			return;
		}

		const selected = await p.select({
			message: 'Select session to continue',
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
		const picked = sessions.find((s) => s.sessionId === sessionId);
		dir = picked?.dir;
		agent = picked?.agent;
	}

	if (!dir) {
		const input = await p.text({message: 'Working directory', initialValue: process.cwd()});
		if (p.isCancel(input)) {
			p.cancel('Cancelled');
			return;
		}
		dir = input;
	}

	let prompt = opts.prompt;
	if (!prompt) {
		const input = await p.text({message: 'Enter follow-up prompt', placeholder: 'Now also fix...'});
		if (p.isCancel(input)) {
			p.cancel('Cancelled');
			return;
		}
		prompt = input;
	}

	const spinner = p.spinner();
	spinner.start('Sending prompt...');

	const result = await executeCodingTool('coding_ask', {agent, prompt, dir, sessionId});

	if (!result.success) {
		spinner.stop(chalk.red('Failed'));
		p.log.error(result.error || 'Unknown error');
		return;
	}

	spinner.stop(chalk.green('Sent'));

	const res = result.result as {sessionId: string; pid: number; message: string};
	p.note(
		[`${chalk.bold('Session ID:')} ${res.sessionId}`, `${chalk.bold('PID:')} ${res.pid}`, '', chalk.dim(res.message)].join('\n'),
		'Prompt Sent',
	);
}

export default function CodingResume({options: opts}: Props) {
	const {exit} = useApp();

	useEffect(() => {
		runResumeSession(opts)
			.catch((err) => p.log.error(err instanceof Error ? err.message : 'Unknown error'))
			.finally(() => setTimeout(() => exit(), 100));
	}, [opts, exit]);

	return null;
}
