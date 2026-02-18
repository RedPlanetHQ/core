import {useEffect} from 'react';
import {useApp} from 'ink';
import * as p from '@clack/prompts';
import chalk from 'chalk';
import zod from 'zod';
import {executeCodingTool} from '@/server/tools/coding-tools';
import {listSessions} from '@/utils/coding-sessions';

export const options = zod.object({
	sessionId: zod.string().optional().describe('Session ID to resume'),
	prompt: zod.string().optional().describe('Prompt to continue with'),
});

type Props = {
	options: zod.infer<typeof options>;
};

async function runResumeSession(
	opts: zod.infer<typeof options>,
): Promise<void> {
	// Get session ID
	let sessionId = opts.sessionId;
	if (!sessionId) {
		const sessions = listSessions().filter((s) => s.status !== 'running');
		if (sessions.length === 0) {
			p.log.error('No resumable sessions found.');
			return;
		}

		const selected = await p.select({
			message: 'Select session to resume',
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

	// Get prompt
	let prompt = opts.prompt;
	if (!prompt) {
		const input = await p.text({
			message: 'Enter prompt to continue',
			placeholder: 'Continue with...',
		});
		if (p.isCancel(input)) {
			p.cancel('Cancelled');
			return;
		}
		prompt = input;
	}

	const spinner = p.spinner();
	spinner.start('Resuming session...');

	const result = await executeCodingTool('coding_resume_session', {
		sessionId,
		prompt,
	});

	if (!result.success) {
		spinner.stop(chalk.red('Failed'));
		p.log.error(result.error || 'Unknown error');
		return;
	}

	spinner.stop(chalk.green('Resumed'));

	const res = result.result as {
		sessionId: string;
		pid: number;
		message: string;
	};
	p.note(
		[
			`${chalk.bold('Session ID:')} ${res.sessionId}`,
			`${chalk.bold('PID:')} ${res.pid}`,
			'',
			chalk.dim(res.message),
		].join('\n'),
		'Session Resumed',
	);
}

export default function CodingResume({options: opts}: Props) {
	const {exit} = useApp();

	useEffect(() => {
		runResumeSession(opts)
			.catch((err) => {
				p.log.error(err instanceof Error ? err.message : 'Unknown error');
			})
			.finally(() => {
				setTimeout(() => exit(), 100);
			});
	}, [opts, exit]);

	return null;
}
