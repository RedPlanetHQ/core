import {useEffect} from 'react';
import {useApp} from 'ink';
import * as p from '@clack/prompts';
import chalk from 'chalk';
import zod from 'zod';
import {isPlaywrightReady} from '@/utils/browser-config';
import {getOrLaunchSession} from '@/utils/browser-manager';

export const args = zod.tuple([
	zod.string().describe('JavaScript expression to evaluate'),
]);

export const options = zod.object({
	session: zod.string().describe('Session name to evaluate on'),
});

type Props = {
	args: zod.infer<typeof args>;
	options: zod.infer<typeof options>;
};

async function runBrowserCommand(sessionName: string, script: string): Promise<void> {
	const spinner = p.spinner();
	spinner.start('Checking Playwright...');

	const ready = await isPlaywrightReady();
	if (!ready) {
		spinner.stop(chalk.red('Not installed'));
		p.log.error('Playwright Chromium is not installed. Run `corebrain browser install` first.');
		return;
	}

	spinner.message(`Evaluating on session "${sessionName}"...`);

	const {session, error} = await getOrLaunchSession(sessionName);
	if (error) {
		spinner.stop(chalk.red('Failed to get session'));
		p.log.error(error);
		return;
	}

	// eslint-disable-next-line no-new-func
	const result = await session.page.evaluate(new Function(`return (${script})`) as () => unknown);

	spinner.stop(chalk.green('Done'));
	console.log(JSON.stringify(result, null, 2));
}

export default function BrowserCommand({args: [script], options}: Props) {
	const {exit} = useApp();

	useEffect(() => {
		runBrowserCommand(options.session, script)
			.catch(err => {
				p.log.error(err instanceof Error ? err.message : 'Unknown error');
			})
			.finally(() => {
				setTimeout(() => exit(), 100);
			});
	}, [options.session, script, exit]);

	return null;
}
