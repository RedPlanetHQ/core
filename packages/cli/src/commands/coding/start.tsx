import {useEffect} from 'react';
import {useApp} from 'ink';
import * as p from '@clack/prompts';
import chalk from 'chalk';
import zod from 'zod';
import {executeCodingTool} from '@/server/tools/coding-tools';
import {getPreferences} from '@/config/preferences';
import type {CliBackendConfig} from '@/types/config';

export const options = zod.object({
	agent: zod.string().optional().describe('Coding agent to use'),
	prompt: zod.string().optional().describe('Task/prompt for the agent'),
	dir: zod.string().optional().describe('Working directory'),
	model: zod.string().optional().describe('Model to use'),
	systemPrompt: zod.string().optional().describe('System prompt'),
});

type Props = {
	options: zod.infer<typeof options>;
};

async function runStartSession(opts: zod.infer<typeof options>): Promise<void> {
	const prefs = getPreferences();
	const coding = prefs.coding as Record<string, CliBackendConfig> | undefined;

	if (!coding || Object.keys(coding).length === 0) {
		p.log.error('No coding agents configured.');
		p.log.info("Run 'corebrain coding setup' to configure an agent.");
		return;
	}

	const availableAgents = Object.keys(coding);

	// Get agent
	let agent = opts.agent;
	if (!agent) {
		const selected = await p.select({
			message: 'Select agent',
			options: availableAgents.map((a) => ({value: a, label: a})),
		});
		if (p.isCancel(selected)) {
			p.cancel('Cancelled');
			return;
		}
		agent = selected as string;
	}

	if (!availableAgents.includes(agent)) {
		p.log.error(`Agent "${agent}" not found.`);
		p.log.info(`Available agents: ${availableAgents.join(', ')}`);
		return;
	}

	// Get prompt
	let prompt = opts.prompt;
	if (!prompt) {
		const input = await p.text({
			message: 'Enter task/prompt',
			placeholder: 'Fix the bug in...',
		});
		if (p.isCancel(input)) {
			p.cancel('Cancelled');
			return;
		}
		prompt = input;
	}

	// Get directory
	let dir = opts.dir;
	if (!dir) {
		const input = await p.text({
			message: 'Working directory',
			initialValue: process.cwd(),
		});
		if (p.isCancel(input)) {
			p.cancel('Cancelled');
			return;
		}
		dir = input;
	}

	const spinner = p.spinner();
	spinner.start('Starting session...');

	const result = await executeCodingTool('coding_start_session', {
		agent,
		prompt,
		dir,
		model: opts.model,
		systemPrompt: opts.systemPrompt,
	});

	if (!result.success) {
		spinner.stop(chalk.red('Failed'));
		p.log.error(result.error || 'Unknown error');
		return;
	}

	spinner.stop(chalk.green('Started'));

	const res = result.result as {sessionId: string; pid: number; message: string};
	p.note(
		[
			`${chalk.bold('Session ID:')} ${res.sessionId}`,
			`${chalk.bold('PID:')} ${res.pid}`,
			'',
			chalk.dim(res.message),
		].join('\n'),
		'Session Started',
	);
}

export default function CodingStart({options: opts}: Props) {
	const {exit} = useApp();

	useEffect(() => {
		runStartSession(opts)
			.catch((err) => {
				p.log.error(err instanceof Error ? err.message : 'Unknown error');
			})
			.finally(() => {
				setTimeout(() => exit(), 100);
			});
	}, [opts, exit]);

	return null;
}
