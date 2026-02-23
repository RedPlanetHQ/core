import { useEffect } from 'react';
import { useApp } from 'ink';
import * as p from '@clack/prompts';
import chalk from 'chalk';
import zod from 'zod';
import { browserGetSessions, isBrowserUseInstalled } from '@/utils/browser-use';

export const options = zod.object({});

type Props = {
	options: zod.infer<typeof options>;
};

async function runListSessions(): Promise<void> {
	const spinner = p.spinner();
	spinner.start('Fetching sessions...');

	const installed = await isBrowserUseInstalled();

	if (!installed) {
		spinner.stop(chalk.red('Not installed'));
		p.log.error('browser-use is not installed. Run `corebrain browser install` first.');
		return;
	}

	const sessions = await browserGetSessions();

	spinner.stop(chalk.green('Sessions retrieved'));

	if (sessions.length === 0) {
		p.log.info('No active sessions found.');
		p.log.info('Run `corebrain browser open <url> --session-name <name>` to create a session.');
		return;
	}

	const lines: string[] = [
		`${chalk.bold('Active Sessions:')} ${chalk.green(`${sessions.length} found`)}`,
		'',
	];

	for (const session of sessions) {
		lines.push(`  ${chalk.dim('•')} ${chalk.cyan(session)}`);
	}

	p.note(lines.join('\n'), 'Browser Sessions');
}

export default function BrowserListSessions(_props: Props) {
	const { exit } = useApp();

	useEffect(() => {
		runListSessions()
			.catch((err) => {
				p.log.error(err instanceof Error ? err.message : 'Unknown error');
			})
			.finally(() => {
				setTimeout(() => exit(), 100);
			});
	}, [exit]);

	return null;
}
