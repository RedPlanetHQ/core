import {useEffect} from 'react';
import {useApp} from 'ink';
import * as p from '@clack/prompts';
import chalk from 'chalk';
import zod from 'zod';
import {deleteSession, getConfiguredSessions, getMaxSessions} from '@/utils/browser-config';
import {closeSession} from '@/utils/browser-manager';

import {requireNativeGateway} from "@/utils/require-native-gateway";

export const args = zod.tuple([zod.string().describe('Session name to delete')]);

export const options = zod.object({});

type Props = {
	args: zod.infer<typeof args>;
	options: zod.infer<typeof options>;
};

async function runDeleteSession(name: string): Promise<void> {
	if (!requireNativeGateway()) return;
	const spinner = p.spinner();
	spinner.start(`Deleting session "${name}"...`);

	// Close the running instance if live
	await closeSession(name);

	const result = deleteSession(name);

	if (!result.success) {
		spinner.stop(chalk.red('Failed'));
		p.log.error(result.error || 'Failed to delete session');
		return;
	}

	spinner.stop(chalk.green(`Session "${name}" deleted`));

	const sessions = getConfiguredSessions();
	const maxSessions = getMaxSessions();
	p.log.info(`Remaining sessions: ${sessions.length}/${maxSessions}`);
}

export default function BrowserDeleteSession({args: [name]}: Props) {
	const {exit} = useApp();

	useEffect(() => {
		runDeleteSession(name)
			.catch(err => {
				p.log.error(
					`Failed to delete session: ${err instanceof Error ? err.message : 'Unknown error'}`,
				);
			})
			.finally(() => {
				setTimeout(() => exit(), 100);
			});
	}, [name, exit]);

	return null;
}
