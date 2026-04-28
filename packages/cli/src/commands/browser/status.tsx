import {useEffect} from 'react';
import {useApp} from 'ink';
import * as p from '@clack/prompts';
import chalk from 'chalk';
import zod from 'zod';
import {
	isPlaywrightReady,
	getConfiguredProfiles,
	getConfiguredSessions,
	getMaxProfiles,
	getMaxSessions,
} from '@/utils/browser-config';
import {getLiveSessions} from '@/utils/browser-manager';

import {requireNativeGateway} from "@/utils/require-native-gateway";

export const options = zod.object({});

type Props = {
	options: zod.infer<typeof options>;
};

async function runBrowserStatus(): Promise<void> {
	if (!requireNativeGateway()) return;
	const spinner = p.spinner();
	spinner.start('Checking browser status...');

	const ready = await isPlaywrightReady();
	const profiles = getConfiguredProfiles();
	const sessions = getConfiguredSessions();
	const live = getLiveSessions();

	spinner.stop(chalk.green('Status retrieved'));

	const lines: string[] = [
		`${chalk.bold('Playwright Chromium:')} ${ready ? chalk.green('installed') : chalk.red('not installed')}`,
		'',
		`${chalk.bold('Profiles:')} ${profiles.length}/${getMaxProfiles()}`,
	];

	for (const profile of profiles) {
		lines.push(`  ${chalk.dim('•')} ${chalk.cyan(profile)}`);
	}

	lines.push('');
	lines.push(`${chalk.bold('Sessions:')} ${sessions.length}/${getMaxSessions()}`);

	for (const session of sessions) {
		const isLive = live.includes(session.name);
		lines.push(
			`  ${chalk.dim('•')} ${chalk.cyan(session.name)} ${chalk.dim(`→ ${session.profile}`)}${
				isLive ? chalk.green(' [live]') : ''
			}`,
		);
	}

	p.note(lines.join('\n'), 'Browser Status');

	if (!ready) {
		p.log.info('Run `corebrain browser install` to install Playwright Chromium');
	} else if (profiles.length === 0) {
		p.log.info('Run `corebrain browser create-profile personal` to get started');
	} else if (sessions.length === 0) {
		p.log.info('Run `corebrain browser create-session <name> --profile personal` to create a session');
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
