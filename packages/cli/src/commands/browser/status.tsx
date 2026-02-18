import { useEffect } from 'react';
import { useApp } from 'ink';
import * as p from '@clack/prompts';
import chalk from 'chalk';
import zod from 'zod';
import { isAgentBrowserInstalled, browserListSessions, browserGetProfiles } from '@/utils/agent-browser';

export const options = zod.object({});

type Props = {
	options: zod.infer<typeof options>;
};

async function runBrowserStatus(): Promise<void> {
	const spinner = p.spinner();
	spinner.start('Checking browser status...');

	const installed = await isAgentBrowserInstalled();
	const sessions = browserListSessions();
	const profiles = browserGetProfiles();

	spinner.stop(chalk.green('Status retrieved'));

	const lines: string[] = [
		`${chalk.bold('agent-browser:')} ${installed ? chalk.green('installed') : chalk.red('not installed')}`,
		`${chalk.bold(`Sessions (${sessions.length}/3):`)} ${sessions.length > 0 ? chalk.green(`${sessions.length} active`) : chalk.dim('none')}`,
	];

	if (sessions.length > 0) {
		for (const session of sessions) {
			lines.push(`  ${chalk.dim('•')} ${chalk.cyan(session.sessionName)} ${chalk.dim('→')} ${session.url} ${chalk.dim(`(profile: ${session.profile})`)}`);
		}
	}

	lines.push(`${chalk.bold('Profiles:')} ${profiles.length > 0 ? profiles.join(', ') : chalk.dim('none')}`);

	p.note(lines.join('\n'), 'Browser Status');

	if (!installed) {
		p.log.info('Run `corebrain browser install` to install agent-browser');
	}
}

export default function BrowserStatus(_props: Props) {
	const { exit } = useApp();

	useEffect(() => {
		runBrowserStatus()
			.catch((err) => {
				p.log.error(err instanceof Error ? err.message : 'Unknown error');
			})
			.finally(() => {
				setTimeout(() => exit(), 100);
			});
	}, [exit]);

	return null;
}
