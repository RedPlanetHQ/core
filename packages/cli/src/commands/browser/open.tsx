import {useEffect} from 'react';
import {useApp} from 'ink';
import * as p from '@clack/prompts';
import chalk from 'chalk';
import zod from 'zod';
import {isPlaywrightReady} from '@/utils/browser-config';
import {launchSession} from '@/utils/browser-manager';

import {requireNativeGateway} from "@/utils/require-native-gateway";

export const args = zod.tuple([zod.string().describe('Session name to open')]);

export const options = zod.object({
	url: zod.string().optional().describe('URL to navigate to after launch'),
	headed: zod.boolean().optional().default(false).describe('Run in headed (visible) mode'),
});

type Props = {
	args: zod.infer<typeof args>;
	options: zod.infer<typeof options>;
};

async function runBrowserOpen(
	sessionName: string,
	url: string | undefined,
	headed: boolean,
): Promise<void> {
	if (!requireNativeGateway()) return;
	const spinner = p.spinner();
	spinner.start('Checking Playwright...');

	const ready = await isPlaywrightReady();
	if (!ready) {
		spinner.stop(chalk.red('Not installed'));
		p.log.error('Playwright Chromium is not installed. Run `corebrain browser install` first.');
		return;
	}

	spinner.message(`Launching session "${sessionName}"${headed ? ' (headed)' : ''}...`);

	const {session, error} = await launchSession(sessionName, headed);

	if (error) {
		spinner.stop(chalk.red('Failed to launch'));
		p.log.error(error);
		return;
	}

	if (url) {
		await session.page.goto(url);
		const title = await session.page.title();
		spinner.stop(chalk.green(`Session "${sessionName}" open — ${url} (${title})`));
	} else {
		spinner.stop(chalk.green(`Session "${sessionName}" open (profile: ${session.profile})`));
	}
}

export default function BrowserOpen({args: [sessionName], options}: Props) {
	const {exit} = useApp();

	useEffect(() => {
		runBrowserOpen(sessionName, options.url, options.headed)
			.catch(err => {
				p.log.error(
					`Failed to open session: ${err instanceof Error ? err.message : 'Unknown error'}`,
				);
			})
			.finally(() => {
				setTimeout(() => exit(), 100);
			});
	}, [sessionName, options.url, options.headed, exit]);

	return null;
}
