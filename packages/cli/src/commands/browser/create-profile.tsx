import { useEffect } from 'react';
import { useApp } from 'ink';
import * as p from '@clack/prompts';
import chalk from 'chalk';
import zod from 'zod';
import { createProfile } from '@/utils/agent-browser';

export const args = zod.tuple([zod.string().describe('Profile name')]);

export const options = zod.object({});

type Props = {
	args: zod.infer<typeof args>;
	options: zod.infer<typeof options>;
};

async function runCreateProfile(name: string): Promise<void> {
	const spinner = p.spinner();
	spinner.start(`Creating profile ${name}...`);

	const result = createProfile(name);

	if (result.success) {
		spinner.stop(chalk.green(`Profile "${name}" created`));
		p.log.info(`Path: ${result.path}`);
	} else {
		spinner.stop(chalk.red('Failed to create profile'));
		p.log.error(result.error || 'Unknown error');
	}
}

export default function BrowserCreateProfile({ args: [name] }: Props) {
	const { exit } = useApp();

	useEffect(() => {
		runCreateProfile(name)
			.catch((err) => {
				p.log.error(`Failed to create profile: ${err instanceof Error ? err.message : 'Unknown error'}`);
			})
			.finally(() => {
				setTimeout(() => exit(), 100);
			});
	}, [name, exit]);

	return null;
}
