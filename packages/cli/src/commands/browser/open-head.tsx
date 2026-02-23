import {useEffect} from 'react';
import {useApp} from 'ink';
import * as p from '@clack/prompts';
import chalk from 'chalk';
import zod from 'zod';
import {
	isBrowserUseInstalled,
	browserOpen,
	browserGetSessions,
} from '@/utils/browser-use';

const DEFAULT_URL = 'https://app.getcore.me';

export const options = zod.object({});

type Props = {
	options: zod.infer<typeof options>;
};

async function runOpenHead(): Promise<void> {
	const spinner = p.spinner();
	spinner.start('Checking browser-use...');

	const installed = await isBrowserUseInstalled();

	if (!installed) {
		spinner.stop(chalk.red('Not installed'));
		p.log.error(
			'browser-use is not installed. Run `corebrain browser install` first.',
		);
		return;
	}

	spinner.stop(chalk.green('Ready'));

	// Get available sessions
	let sessions = await browserGetSessions();

	// Add default session options if no sessions exist
	if (sessions.length === 0) {
		sessions = ['personal', 'work'];
	} else {
		// Add common options if not already present
		if (!sessions.includes('personal')) sessions.push('personal');
		if (!sessions.includes('work')) sessions.push('work');
	}

	// Show session selector
	const selectedSession = await p.select({
		message: 'Select a session to use:',
		options: sessions.map(session => ({
			value: session,
			label: session,
		})),
	});

	if (p.isCancel(selectedSession)) {
		p.log.info('Cancelled');
		return;
	}

	const openSpinner = p.spinner();
	openSpinner.start(
		`Opening ${DEFAULT_URL} with session "${selectedSession}" (headed)...`,
	);

	// Open in headed mode
	const result = await browserOpen(DEFAULT_URL, selectedSession, true);

	if (result.code !== 0) {
		openSpinner.stop(chalk.red('Failed to open browser'));
		p.log.error(result.stderr || 'Failed to open browser');
		return;
	}

	openSpinner.stop(
		chalk.green(`Opened ${DEFAULT_URL} (session: ${selectedSession}, headed)`),
	);
}

export default function BrowserOpenHead(_props: Props) {
	const {exit} = useApp();

	useEffect(() => {
		runOpenHead()
			.catch(err => {
				p.log.error(
					`Failed: ${err instanceof Error ? err.message : 'Unknown error'}`,
				);
			})
			.finally(() => {
				setTimeout(() => exit(), 100);
			});
	}, [exit]);

	return null;
}
