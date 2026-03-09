import { useEffect } from 'react';
import { useApp } from 'ink';
import * as p from '@clack/prompts';
import chalk from 'chalk';
import zod from 'zod';
import { getConfig } from '@/config/index';

export const options = zod.object({});

type Props = {
	options: zod.infer<typeof options>;
};

interface IntegrationDefinition {
	id: string;
	name: string;
	slug: string;
	description: string;
	icon: string;
	workspaceId: string | null;
}

async function runListIntegrations(): Promise<{ success: boolean; error?: string }> {
	p.intro(chalk.bgCyan(chalk.black(' Integrations ')));

	const config = getConfig();

	if (!config.auth?.apiKey || !config.auth?.url) {
		p.log.error('Not authenticated. Please run "corebrain login" first.');
		return { success: false, error: 'Not authenticated' };
	}

	const spinner = p.spinner();
	spinner.start('Fetching integrations...');

	try {
		const response = await fetch(`${config.auth.url}/api/v1/integration_definitions`, {
			method: 'GET',
			headers: {
				'Content-Type': 'application/json',
				Authorization: `Bearer ${config.auth.apiKey}`,
			},
		});

		if (!response.ok) {
			const errorData = (await response.json()) as { error?: string };
			throw new Error(errorData.error || 'Failed to fetch integrations');
		}

		const result = (await response.json()) as { definitions?: IntegrationDefinition[] };
		const definitions: IntegrationDefinition[] = result.definitions || [];

		spinner.stop(chalk.green(`Found ${definitions.length} integration(s)`));

		if (definitions.length === 0) {
			p.log.info('No integrations found. Use "corebrain integrations add" to create one.');
		} else {
			const globalDefs = definitions.filter((d) => !d.workspaceId);
			const workspaceDefs = definitions.filter((d) => d.workspaceId);

			if (workspaceDefs.length > 0) {
				p.log.info(chalk.bold('\nWorkspace Integrations:'));
				for (const def of workspaceDefs) {
					console.log(`  ${chalk.cyan(def.name)} ${chalk.dim(`(${def.slug})`)}`);
					console.log(`    ${chalk.dim(def.description)}`);
				}
			}

			if (globalDefs.length > 0) {
				p.log.info(chalk.bold('\nGlobal Integrations:'));
				for (const def of globalDefs) {
					console.log(`  ${chalk.cyan(def.name)} ${chalk.dim(`(${def.slug})`)}`);
					console.log(`    ${chalk.dim(def.description)}`);
				}
			}
		}

		return { success: true };
	} catch (error) {
		spinner.stop(chalk.red('Failed'));
		p.log.error(error instanceof Error ? error.message : 'Unknown error');
		return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
	}
}

export default function IntegrationsList(_props: Props) {
	const { exit } = useApp();

	useEffect(() => {
		runListIntegrations()
			.catch((err) => {
				p.log.error(err instanceof Error ? err.message : 'Unknown error');
			})
			.finally(() => {
				setTimeout(() => exit(), 100);
			});
	}, [exit]);

	return null;
}
