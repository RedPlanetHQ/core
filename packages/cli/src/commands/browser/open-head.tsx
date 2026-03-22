import {useEffect} from 'react';
import {useApp} from 'ink';
import * as p from '@clack/prompts';
import chalk from 'chalk';
import zod from 'zod';
import {isPlaywrightReady, getConfiguredSessions} from '@/utils/browser-config';
import {launchSession} from '@/utils/browser-manager';

export const options = zod.object({});

type Props = {
	options: zod.infer<typeof options>;
};

async function runOpenHead(): Promise<void> {
	const spinner = p.spinner();
	spinner.start('Checking Playwright...');

	const ready = await isPlaywrightReady();
	if (!ready) {
		spinner.stop(chalk.red('Not installed'));
		p.log.error('Playwright Chromium is not installed. Run `corebrain browser install` first.');
		return;
	}

	spinner.stop(chalk.green('Ready'));

	const sessions = getConfiguredSessions();
	if (sessions.length === 0) {
		p.log.error('No sessions configured.');
		p.log.info('Run: corebrain browser create-session <name> --profile <profile>');
		return;
	}

	const selected = await p.select({
		message: 'Select a session to open (headed):',
		options: sessions.map(s => ({
			value: s.name,
			label: `${s.name}`,
			hint: `profile: ${s.profile}`,
		})),
	});

	if (p.isCancel(selected)) {
		p.log.info('Cancelled');
		return;
	}

	const openSpinner = p.spinner();
	openSpinner.start(`Launching session "${selected}" in headed mode...`);

	const {session, error} = await launchSession(selected as string, true);

	if (error) {
		openSpinner.stop(chalk.red('Failed to launch'));
		p.log.error(error);
		return;
	}

	openSpinner.stop(
		chalk.green(`Session "${selected}" open (profile: ${session.profile}, headed)`),
	);
}

export default function BrowserOpenHead(_props: Props) {
	const {exit} = useApp();

	useEffect(() => {
		runOpenHead()
			.catch(err => {
				p.log.error(`Failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
			})
			.finally(() => {
				setTimeout(() => exit(), 100);
			});
	}, [exit]);

	return null;
}
