import {useEffect} from 'react';
import {useApp} from 'ink';
import * as p from '@clack/prompts';
import chalk from 'chalk';
import zod from 'zod';
import {
	isBrowserUseInstalled,
	browserGetSessions,
	getServerStatus,
} from '@/utils/browser-use';

export const options = zod.object({});

type Props = {
	options: zod.infer<typeof options>;
};

async function runBrowserStatus(): Promise<void> {
	const spinner = p.spinner();
	spinner.start('Checking browser status...');

	const installed = await isBrowserUseInstalled();
	const sessions = installed ? await browserGetSessions() : [];
	const serverStatus = installed ? await getServerStatus() : null;

	spinner.stop(chalk.green('Status retrieved'));

	const lines: string[] = [
		`${chalk.bold('browser-use:')} ${
			installed ? chalk.green('installed') : chalk.red('not installed')
		}`,
	];

	if (installed && serverStatus) {
		const serverRunning = serverStatus.code === 0;
		lines.push(
			`${chalk.bold('Server:')} ${
				serverRunning ? chalk.green('running') : chalk.dim('stopped')
			}`,
		);
	}

	lines.push(
		`${chalk.bold('Sessions:')} ${
			sessions.length > 0
				? chalk.green(`${sessions.length} active`)
				: chalk.dim('none')
		}`,
	);

	if (sessions.length > 0) {
		for (const session of sessions) {
			lines.push(`  ${chalk.dim('•')} ${chalk.cyan(session)}`);
		}
	}

	p.note(lines.join('\n'), 'Browser Status');

	if (!installed) {
		p.log.info('Run `corebrain browser install` to install browser-use');
	}

	if (sessions.length === 0 && installed) {
		p.log.info(
			'Run `corebrain browser open <url> --session-name <name>` to create a session',
		);
	}
}

export default function BrowserStatus(_props: Props) {
	const {exit} = useApp();

	useEffect(() => {
		runBrowserStatus()
			.catch(err => {
				p.log.error(err instanceof Error ? err.message : 'Unknown error');
			})
			.finally(() => {
				setTimeout(() => exit(), 100);
			});
	}, [exit]);

	return null;
}
