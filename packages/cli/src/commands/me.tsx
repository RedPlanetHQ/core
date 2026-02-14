import { useEffect } from 'react';
import { useApp } from 'ink';
import * as p from '@clack/prompts';
import chalk from 'chalk';
import zod from 'zod';
import { CoreClient } from '@redplanethq/sdk';
import { getConfig } from '@/config/index';

const BASE_URL = 'https://app.getcore.me';

export const options = zod.object({});

type Props = {
	options: zod.infer<typeof options>;
};

async function runMe(): Promise<void> {
	const config = getConfig();
	const apiKey = config.auth?.apiKey;
	const url = config.auth?.url;

	if (!apiKey) {
		p.log.error('Not authenticated. Please run the login command first.');
		return;
	}

	const spinner = p.spinner();
	spinner.start('Fetching user info...');

	try {
		const client = new CoreClient({
			baseUrl: url || BASE_URL,
			token: apiKey,
		});
		const user = await client.me();

		spinner.stop(chalk.green('User info retrieved'));

		p.note(
			[
				`${chalk.bold('Name:')} ${user?.name || 'Not set'}`,
				user?.email ? `${chalk.bold('Email:')} ${user.email}` : null,
				user?.workspaceId ? `${chalk.bold('Workspace ID:')} ${user.workspaceId}` : null,
			]
				.filter(Boolean)
				.join('\n'),
			'User Info'
		);
	} catch (err) {
		spinner.stop(chalk.red('Failed to fetch user info'));
		p.log.error(err instanceof Error ? err.message : 'Failed to fetch user info');
	}
}

export default function Me(_props: Props) {
	const { exit } = useApp();

	useEffect(() => {
		runMe().finally(() => {
			setTimeout(() => exit(), 100);
		});
	}, [exit]);

	return null;
}
