import {useEffect} from 'react';
import {useApp} from 'ink';
import * as p from '@clack/prompts';
import chalk from 'chalk';
import zod from 'zod';
import {closeSession} from '@/utils/browser-manager';

export const args = zod.tuple([zod.string().describe('Session name to close')]);

export const options = zod.object({});

type Props = {
	args: zod.infer<typeof args>;
	options: zod.infer<typeof options>;
};

async function runCloseSession(name: string): Promise<void> {
	const spinner = p.spinner();
	spinner.start(`Closing session "${name}"...`);

	const result = await closeSession(name);

	if (!result.success) {
		spinner.stop(chalk.yellow(`Session "${name}" was not running`));
		if (result.error) p.log.info(result.error);
		return;
	}

	spinner.stop(chalk.green(`Session "${name}" closed (profile data preserved)`));
}

export default function BrowserCloseSession({args: [name]}: Props) {
	const {exit} = useApp();

	useEffect(() => {
		runCloseSession(name)
			.catch(err => {
				p.log.error(`Failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
			})
			.finally(() => {
				setTimeout(() => exit(), 100);
			});
	}, [name, exit]);

	return null;
}
