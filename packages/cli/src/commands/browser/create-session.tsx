import {useEffect} from 'react';
import {useApp} from 'ink';
import * as p from '@clack/prompts';
import chalk from 'chalk';
import zod from 'zod';
import {
	createSession,
	getConfiguredSessions,
	getConfiguredProfiles,
	getMaxSessions,
} from '@/utils/browser-config';

import {requireNativeGateway} from "@/utils/require-native-gateway";

export const args = zod.tuple([zod.string().describe('Session name to create')]);

export const options = zod.object({
	profile: zod.string().describe('Profile to bind this session to (e.g. personal, work)'),
});

type Props = {
	args: zod.infer<typeof args>;
	options: zod.infer<typeof options>;
};

async function runCreateSession(name: string, profile: string): Promise<void> {
	if (!requireNativeGateway()) return;
	const spinner = p.spinner();
	spinner.start(`Creating session "${name}" with profile "${profile}"...`);

	const result = createSession(name, profile);

	if (!result.success) {
		spinner.stop(chalk.red('Failed'));
		p.log.error(result.error || 'Failed to create session');

		const profiles = getConfiguredProfiles();
		if (profiles.length === 0) {
			p.log.info('No profiles configured. Run: corebrain browser create-profile <name>');
		} else {
			p.log.info(`Available profiles: ${profiles.join(', ')}`);
		}
		return;
	}

	spinner.stop(chalk.green(`Session "${name}" created (profile: ${profile})`));

	const sessions = getConfiguredSessions();
	const maxSessions = getMaxSessions();
	p.log.info(`Sessions: ${sessions.length}/${maxSessions}`);
	p.log.info(`Run: corebrain browser open ${name}`);
}

export default function BrowserCreateSession({args: [name], options}: Props) {
	const {exit} = useApp();

	useEffect(() => {
		runCreateSession(name, options.profile)
			.catch(err => {
				p.log.error(
					`Failed to create session: ${err instanceof Error ? err.message : 'Unknown error'}`,
				);
			})
			.finally(() => {
				setTimeout(() => exit(), 100);
			});
	}, [name, options.profile, exit]);

	return null;
}
