import {useEffect} from 'react';
import {useApp} from 'ink';
import * as p from '@clack/prompts';
import chalk from 'chalk';
import zod from 'zod';
import {
	isAgentBrowserInstalled,
	installAgentBrowser,
	runAgentBrowserDoctor,
	browserGetSessions,
	getMaxSessions,
} from '@/utils/agent-browser';

export const options = zod.object({});

type Props = {
	options: zod.infer<typeof options>;
};

async function runBrowserInstall(): Promise<void> {
	const spinner = p.spinner();
	spinner.start('Checking if agent-browser is installed...');

	const installed = await isAgentBrowserInstalled();

	if (installed) {
		spinner.stop(chalk.green('agent-browser is already installed'));

		// Check version
		const versionSpinner = p.spinner();
		versionSpinner.start('Checking version...');
		const versionResult = await runAgentBrowserDoctor();

		if (versionResult.code === 0) {
			versionSpinner.stop(chalk.green('Installation validated'));
			if (versionResult.stdout) {
				console.log(versionResult.stdout.trim());
			}
		} else {
			versionSpinner.stop(chalk.yellow('Could not verify version'));
		}

		// Show configured sessions
		const sessions = browserGetSessions();
		const maxSessions = getMaxSessions();
		if (sessions.length > 0) {
			p.log.info(`Configured sessions (${sessions.length}/${maxSessions}): ${sessions.join(', ')}`);
		} else {
			p.log.info('No sessions configured. Run `corebrain browser create-session <name>` to create one.');
		}

		// Recommend Brave
		p.log.info('');
		p.log.info(chalk.bold('Recommended browser: Brave'));
		p.log.info('Install: brew install --cask brave-browser');

		return;
	}

	spinner.message('Installing agent-browser via npm...');

	const result = await installAgentBrowser();

	if (result.code !== 0) {
		spinner.stop(chalk.red('Installation failed'));
		p.log.error(result.stderr || 'Installation failed');
		return;
	}

	spinner.stop(chalk.green('agent-browser installed successfully'));

	// Show default sessions created
	const sessions = browserGetSessions();
	const maxSessions = getMaxSessions();
	p.log.info(`Default sessions created (${sessions.length}/${maxSessions}): ${sessions.join(', ')}`);

	// Recommend Brave
	p.log.info('');
	p.log.info(chalk.bold('Recommended browser: Brave'));
	p.log.info('Install: brew install --cask brave-browser');
}

export default function BrowserInstall(_props: Props) {
	const {exit} = useApp();

	useEffect(() => {
		runBrowserInstall()
			.catch(err => {
				p.log.error(
					`Failed to install agent-browser: ${
						err instanceof Error ? err.message : 'Unknown error'
					}`,
				);
			})
			.finally(() => {
				setTimeout(() => exit(), 100);
			});
	}, [exit]);

	return null;
}
