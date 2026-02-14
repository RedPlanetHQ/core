import { useEffect } from 'react';
import { useApp } from 'ink';
import * as p from '@clack/prompts';
import chalk from 'chalk';
import zod from 'zod';
import { deleteProfile } from '@/utils/agent-browser';

export const args = zod.tuple([zod.string().describe('Profile name')]);

export const options = zod.object({});

type Props = {
	args: zod.infer<typeof args>;
	options: zod.infer<typeof options>;
};

async function runDeleteProfile(name: string): Promise<void> {
	const spinner = p.spinner();
	spinner.start(`Deleting profile ${name}...`);

	const result = deleteProfile(name);

	if (result.success) {
		spinner.stop(chalk.green(`Profile "${name}" deleted`));
	} else {
		spinner.stop(chalk.red('Failed to delete profile'));
		p.log.error(result.error || 'Unknown error');
	}
}

export default function BrowserDeleteProfile({ args: [name] }: Props) {
	const { exit } = useApp();

	useEffect(() => {
		runDeleteProfile(name)
			.catch((err) => {
				p.log.error(`Failed to delete profile: ${err instanceof Error ? err.message : 'Unknown error'}`);
			})
			.finally(() => {
				setTimeout(() => exit(), 100);
			});
	}, [name, exit]);

	return null;
}
