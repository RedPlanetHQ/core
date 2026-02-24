import { useEffect } from 'react';
import { useApp } from 'ink';
import * as p from '@clack/prompts';
import chalk from 'chalk';
import zod from 'zod';
import { isAgentBrowserInstalled, browserCommand, isBlockedCommand } from '@/utils/agent-browser';

export const args = zod.tuple([
	zod.string().describe('Command to run'),
]).rest(zod.string().describe('Command arguments'));

export const options = zod.object({
	sessionName: zod.string().optional().default('default').describe('Session name to use (default: default)'),
});

type Props = {
	args: zod.infer<typeof args>;
	options: zod.infer<typeof options>;
};

async function runBrowserCommand(sessionName: string, command: string, commandArgs: string[]): Promise<void> {
	const spinner = p.spinner();
	spinner.start('Checking agent-browser...');

	const installed = await isAgentBrowserInstalled();

	if (!installed) {
		spinner.stop(chalk.red('Not installed'));
		p.log.error('agent-browser is not installed. Run `corebrain browser install` first.');
		return;
	}

	// Check if command is blocked
	if (isBlockedCommand(command)) {
		spinner.stop(chalk.red('Command blocked'));
		p.log.error(`Command "${command}" is blocked. Use \`corebrain browser open\` or \`corebrain browser close\` for open/close operations.`);
		return;
	}

	spinner.message(`Running: ${command} ${commandArgs.join(' ')} on session "${sessionName}"`);

	const result = await browserCommand(sessionName, command, commandArgs);

	spinner.stop(result.code === 0 ? chalk.green('Command completed') : chalk.yellow(`Exit code: ${result.code}`));

	if (result.stdout) {
		console.log(result.stdout);
	}
	if (result.stderr) {
		console.error(chalk.red(result.stderr));
	}
}

export default function BrowserCommand({ args: [command, ...commandArgs], options }: Props) {
	const { exit } = useApp();

	useEffect(() => {
		runBrowserCommand(options.sessionName, command, commandArgs)
			.catch((err) => {
				p.log.error(err instanceof Error ? err.message : 'Unknown error');
			})
			.finally(() => {
				setTimeout(() => exit(), 100);
			});
	}, [options.sessionName, command, commandArgs, exit]);

	return null;
}
