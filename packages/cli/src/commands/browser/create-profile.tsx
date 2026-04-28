import {useEffect} from 'react';
import {useApp} from 'ink';
import * as p from '@clack/prompts';
import chalk from 'chalk';
import zod from 'zod';
import {createProfile, getConfiguredProfiles, getMaxProfiles} from '@/utils/browser-config';

import {requireNativeGateway} from "@/utils/require-native-gateway";

export const args = zod.tuple([zod.string().describe('Profile name to create (e.g. personal, work)')]);

export const options = zod.object({});

type Props = {
	args: zod.infer<typeof args>;
	options: zod.infer<typeof options>;
};

async function runCreateProfile(name: string): Promise<void> {
	if (!requireNativeGateway()) return;
	const spinner = p.spinner();
	spinner.start(`Creating profile "${name}"...`);

	const result = createProfile(name);

	if (!result.success) {
		spinner.stop(chalk.red('Failed'));
		p.log.error(result.error || 'Failed to create profile');
		return;
	}

	spinner.stop(chalk.green(`Profile "${name}" created`));

	const profiles = getConfiguredProfiles();
	const maxProfiles = getMaxProfiles();
	p.log.info(`Profiles: ${profiles.join(', ')} (${profiles.length}/${maxProfiles})`);
	p.log.info(`Now create a session: corebrain browser create-session <session-name> --profile ${name}`);
}

export default function BrowserCreateProfile({args: [name]}: Props) {
	const {exit} = useApp();

	useEffect(() => {
		runCreateProfile(name)
			.catch(err => {
				p.log.error(
					`Failed to create profile: ${err instanceof Error ? err.message : 'Unknown error'}`,
				);
			})
			.finally(() => {
				setTimeout(() => exit(), 100);
			});
	}, [name, exit]);

	return null;
}
