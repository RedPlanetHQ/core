import { useEffect } from 'react';
import { useApp } from 'ink';
import * as p from '@clack/prompts';
import chalk from 'chalk';
import zod from 'zod';
import { getConfig } from '@/config/index';

export const options = zod.object({});

export const args = zod.tuple([zod.string().describe('Integration ID or slug').optional()]);

type Props = {
	options: zod.infer<typeof options>;
	args: zod.infer<typeof args>;
};

interface IntegrationDefinition {
	id: string;
	name: string;
	slug: string;
	description: string;
	workspaceId: string | null;
}

async function runRemoveIntegration(integrationIdOrSlug?: string): Promise<{ success: boolean; error?: string }> {
	p.intro(chalk.bgRed(chalk.white(' Remove Integration ')));

	const config = getConfig();

	if (!config.auth?.apiKey || !config.auth?.url) {
		p.log.error('Not authenticated. Please run "corebrain login" first.');
		return { success: false, error: 'Not authenticated' };
	}

	// Fetch integrations to show selection if no ID provided
	let integrationId = integrationIdOrSlug;

	if (!integrationId) {
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
				throw new Error('Failed to fetch integrations');
			}

			const result = (await response.json()) as { definitions?: IntegrationDefinition[] };
			const definitions: IntegrationDefinition[] = (result.definitions || []).filter(
				(d: IntegrationDefinition) => d.workspaceId, // Only show workspace integrations (can't delete global)
			);

			spinner.stop('');

			if (definitions.length === 0) {
				p.log.info('No workspace integrations to remove.');
				return { success: true };
			}

			const selected = await p.select({
				message: 'Select integration to remove',
				options: definitions.map((d) => ({
					value: d.id,
					label: `${d.name} (${d.slug})`,
					hint: d.description,
				})),
			});

			if (p.isCancel(selected)) {
				p.cancel('Cancelled');
				return { success: false, error: 'Cancelled' };
			}

			integrationId = selected as string;
		} catch (error) {
			spinner.stop(chalk.red('Failed'));
			p.log.error(error instanceof Error ? error.message : 'Unknown error');
			return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
		}
	}

	// Confirm deletion
	const confirm = await p.confirm({
		message: chalk.red('Are you sure you want to delete this integration?'),
		initialValue: false,
	});

	if (p.isCancel(confirm) || !confirm) {
		p.cancel('Cancelled');
		return { success: false, error: 'Cancelled' };
	}

	// Delete integration
	const spinner = p.spinner();
	spinner.start('Removing integration...');

	try {
		const response = await fetch(`${config.auth.url}/api/v1/integration_definitions/${integrationId}`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Authorization: `Bearer ${config.auth.apiKey}`,
			},
			body: JSON.stringify({ _method: 'DELETE' }),
		});

		if (!response.ok) {
			const errorData = (await response.json()) as { error?: string };
			throw new Error(errorData.error || 'Failed to remove integration');
		}

		spinner.stop(chalk.green('Integration removed'));
		p.outro(chalk.green('Successfully removed integration'));
		return { success: true };
	} catch (error) {
		spinner.stop(chalk.red('Failed'));
		p.log.error(error instanceof Error ? error.message : 'Unknown error');
		return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
	}
}

export default function IntegrationsRemove({ args: [integrationId] }: Props) {
	const { exit } = useApp();

	useEffect(() => {
		runRemoveIntegration(integrationId)
			.catch((err) => {
				p.log.error(err instanceof Error ? err.message : 'Unknown error');
			})
			.finally(() => {
				setTimeout(() => exit(), 100);
			});
	}, [integrationId, exit]);

	return null;
}
