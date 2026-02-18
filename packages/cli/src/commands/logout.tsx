import { useEffect } from 'react';
import { useApp } from 'ink';
import * as p from '@clack/prompts';
import chalk from 'chalk';
import zod from 'zod';
import { getConfig, updateConfig } from '@/config/index';

export const options = zod.object({});

type Props = {
	options: zod.infer<typeof options>;
};

async function runLogout(): Promise<void> {
	const config = getConfig();

	if (!config.auth?.apiKey) {
		p.log.warning('Already logged out. No authentication found in config.');
		return;
	}

	try {
		updateConfig({ auth: undefined });
		p.log.success(chalk.green('Successfully logged out. Authentication cleared from config.'));
	} catch (err) {
		p.log.error(err instanceof Error ? err.message : 'Failed to clear authentication');
	}
}

export default function Logout(_props: Props) {
	const { exit } = useApp();

	useEffect(() => {
		runLogout().finally(() => {
			setTimeout(() => exit(), 100);
		});
	}, [exit]);

	return null;
}
