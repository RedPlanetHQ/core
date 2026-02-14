import { useEffect } from 'react';
import { useApp } from 'ink';
import * as p from '@clack/prompts';
import chalk from 'chalk';
import zod from 'zod';
import { getPreferences, updatePreferences } from '@/config/preferences';
import type { CliBackendConfig } from '@/types/config';

export const options = zod.object({
	agent: zod.string().describe('Agent name to remove'),
});

type Props = {
	options: zod.infer<typeof options>;
};

async function runCodingRemove(agentName: string): Promise<void> {
	const prefs = getPreferences();
	const coding = (prefs.coding || {}) as Record<string, CliBackendConfig>;

	if (!coding[agentName]) {
		p.log.warning(`Agent "${agentName}" not found.`);
		return;
	}

	// Remove the agent
	delete coding[agentName];
	updatePreferences({ coding });

	p.log.success(chalk.green(`Removed "${agentName}" configuration.`));
}

export default function CodingRemove({ options: opts }: Props) {
	const { exit } = useApp();

	useEffect(() => {
		runCodingRemove(opts.agent)
			.catch((err) => {
				p.log.error(`Error: ${err instanceof Error ? err.message : 'Unknown error'}`);
			})
			.finally(() => {
				setTimeout(() => exit(), 100);
			});
	}, [opts.agent, exit]);

	return null;
}
