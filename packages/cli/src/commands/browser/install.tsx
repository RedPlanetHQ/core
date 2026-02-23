import {useEffect} from 'react';
import {useApp} from 'ink';
import * as p from '@clack/prompts';
import chalk from 'chalk';
import zod from 'zod';
import {
	isBrowserUseInstalled,
	installBrowserUse,
	runBrowserUseDoctor,
} from '@/utils/browser-use';

export const options = zod.object({});

type Props = {
	options: zod.infer<typeof options>;
};

async function runBrowserInstall(): Promise<void> {
	const spinner = p.spinner();
	spinner.start('Checking if browser-use is installed...');

	const installed = await isBrowserUseInstalled();

	if (installed) {
		spinner.stop(chalk.green('browser-use is already installed'));

		// Run doctor to validate installation
		const doctorSpinner = p.spinner();
		doctorSpinner.start('Running browser-use doctor...');
		const doctorResult = await runBrowserUseDoctor();

		if (doctorResult.code === 0) {
			doctorSpinner.stop(chalk.green('Installation validated'));
			if (doctorResult.stdout) {
				console.log(doctorResult.stdout);
			}
		} else {
			doctorSpinner.stop(chalk.yellow('Doctor reported issues'));
			if (doctorResult.stdout) {
				console.log(doctorResult.stdout);
			}
			if (doctorResult.stderr) {
				console.error(chalk.red(doctorResult.stderr));
			}
		}
		return;
	}

	spinner.message('Installing browser-use...');

	const result = await installBrowserUse();

	if (result.code !== 0) {
		spinner.stop(chalk.red('Installation failed'));
		p.log.error(result.stderr || 'Installation failed');
		return;
	}

	spinner.stop(chalk.green('browser-use installed successfully'));

	// Run doctor to validate
	const doctorSpinner = p.spinner();
	doctorSpinner.start('Validating installation with browser-use doctor...');
	const doctorResult = await runBrowserUseDoctor();

	if (doctorResult.code === 0) {
		doctorSpinner.stop(chalk.green('Installation validated'));
	} else {
		doctorSpinner.stop(
			chalk.yellow(
				'Doctor reported issues - you may need to fix these manually',
			),
		);
		if (doctorResult.stdout) {
			console.log(doctorResult.stdout);
		}
	}
}

export default function BrowserInstall(_props: Props) {
	const {exit} = useApp();

	useEffect(() => {
		runBrowserInstall()
			.catch(err => {
				p.log.error(
					`Failed to install browser-use: ${
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
