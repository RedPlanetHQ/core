import {useEffect} from 'react';
import {useApp} from 'ink';
import * as p from '@clack/prompts';
import chalk from 'chalk';
import zod from 'zod';
import {deleteProfile, getConfiguredProfiles, getMaxProfiles} from '@/utils/browser-config';
import {closeAllSessions} from '@/utils/browser-manager';

export const args = zod.tuple([zod.string().describe('Profile name to delete')]);

export const options = zod.object({});

type Props = {
	args: zod.infer<typeof args>;
	options: zod.infer<typeof options>;
};

async function runDeleteProfile(name: string): Promise<void> {
	const spinner = p.spinner();
	spinner.start(`Deleting profile "${name}"...`);

	// Close any live sessions using this profile
	await closeAllSessions();

	const result = deleteProfile(name);

	if (!result.success) {
		spinner.stop(chalk.red('Failed'));
		p.log.error(result.error || 'Failed to delete profile');
		return;
	}

	spinner.stop(chalk.green(`Profile "${name}" deleted (browser data removed from disk)`));

	const profiles = getConfiguredProfiles();
	const maxProfiles = getMaxProfiles();
	if (profiles.length > 0) {
		p.log.info(`Remaining profiles: ${profiles.join(', ')} (${profiles.length}/${maxProfiles})`);
	} else {
		p.log.info('No profiles. Create one: corebrain browser create-profile <name>');
	}
}

export default function BrowserDeleteProfile({args: [name]}: Props) {
	const {exit} = useApp();

	useEffect(() => {
		runDeleteProfile(name)
			.catch(err => {
				p.log.error(
					`Failed to delete profile: ${err instanceof Error ? err.message : 'Unknown error'}`,
				);
			})
			.finally(() => {
				setTimeout(() => exit(), 100);
			});
	}, [name, exit]);

	return null;
}
