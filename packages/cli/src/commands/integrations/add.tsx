import { useEffect } from 'react';
import { useApp } from 'ink';
import * as p from '@clack/prompts';
import chalk from 'chalk';
import zod from 'zod';
import { getConfig } from '@/config/index';
import { CoreClient } from '@redplanethq/sdk';

export const options = zod.object({});

type Props = {
	options: zod.infer<typeof options>;
};

interface AuthField {
	name: string;
	label: string;
	placeholder: string;
	description: string;
}

interface OAuth2Config {
	token_url: string;
	authorization_url: string;
	scopes: string[];
	scope_identifier: string;
	scope_separator: string;
	token_params: Record<string, string>;
	authorization_params: Record<string, string>;
}

interface Spec {
	name: string;
	key: string;
	description: string;
	icon: string;
	mcp: { type: 'cli' };
	schedule?: { frequency: string };
	auth: Record<string, any>;
}

async function runAddIntegration(): Promise<{ success: boolean; error?: string }> {
	p.intro(chalk.bgCyan(chalk.black(' Add Integration ')));

	const config = getConfig();

	if (!config.auth?.apiKey || !config.auth?.url) {
		p.log.error('Not authenticated. Please run "corebrain login" first.');
		return { success: false, error: 'Not authenticated' };
	}

	// Step 1: Name
	const name = await p.text({
		message: 'Integration name',
		placeholder: 'My Integration',
		validate: (value) => {
			if (!value?.trim()) return 'Name is required';
		},
	});
	if (p.isCancel(name)) {
		p.cancel('Cancelled');
		return { success: false, error: 'Cancelled' };
	}

	// Step 2: Description
	const description = await p.text({
		message: 'Description',
		placeholder: 'Connect to my service...',
		validate: (value) => {
			if (!value?.trim()) return 'Description is required';
		},
	});
	if (p.isCancel(description)) {
		p.cancel('Cancelled');
		return { success: false, error: 'Cancelled' };
	}

	// Step 3: Slug
	const defaultSlug = (name as string).toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
	const slug = await p.text({
		message: 'Slug (unique identifier)',
		placeholder: defaultSlug,
		initialValue: defaultSlug,
		validate: (value) => {
			if (!value?.trim()) return 'Slug is required';
			if (!/^[a-z0-9-]+$/.test(value)) return 'Slug must be lowercase alphanumeric with hyphens only';
		},
	});
	if (p.isCancel(slug)) {
		p.cancel('Cancelled');
		return { success: false, error: 'Cancelled' };
	}

	// Step 4: Auth type
	const authType = await p.select({
		message: 'Authentication type',
		options: [
			{ value: 'api_key', label: 'API Key' },
			{ value: 'OAuth2', label: 'OAuth2' },
		],
	});
	if (p.isCancel(authType)) {
		p.cancel('Cancelled');
		return { success: false, error: 'Cancelled' };
	}

	// Step 5: URL (source)
	const url = await p.text({
		message: 'Integration source URL',
		placeholder: 'https://docs.myservice.com',
		validate: (value) => {
			if (!value?.trim()) return 'URL is required';
			try {
				new URL(value);
			} catch {
				return 'Must be a valid URL';
			}
		},
	});
	if (p.isCancel(url)) {
		p.cancel('Cancelled');
		return { success: false, error: 'Cancelled' };
	}

	// Step 6: Trigger type (schedule or webhook)
	const triggerType = await p.select({
		message: 'How will this integration be triggered?',
		options: [
			{ value: 'webhook', label: 'Webhook (receives events)' },
			{ value: 'schedule', label: 'Schedule (periodic sync)' },
		],
	});
	if (p.isCancel(triggerType)) {
		p.cancel('Cancelled');
		return { success: false, error: 'Cancelled' };
	}

	let scheduleInterval: string | undefined;
	if (triggerType === 'schedule') {
		const interval = await p.select({
			message: 'Sync interval',
			options: [
				{ value: '15', label: 'Every 15 minutes' },
				{ value: '20', label: 'Every 20 minutes' },
				{ value: '30', label: 'Every 30 minutes' },
			],
		});
		if (p.isCancel(interval)) {
			p.cancel('Cancelled');
			return { success: false, error: 'Cancelled' };
		}
		scheduleInterval = `*/${interval} * * * *`;
	}

	// Build spec based on auth type
	const spec: Spec = {
		name: name as string,
		key: slug as string,
		description: description as string,
		icon: slug as string,
		mcp: { type: 'cli' },
		auth: {},
	};

	if (scheduleInterval) {
		spec.schedule = { frequency: scheduleInterval };
	}

	if (authType === 'OAuth2') {
		// OAuth2 configuration
		p.log.info(chalk.dim('Configure OAuth2 settings:'));

		const tokenUrl = await p.text({
			message: 'Token URL',
			placeholder: 'https://oauth.example.com/token',
			validate: (value) => {
				if (!value?.trim()) return 'Token URL is required';
				try {
					new URL(value);
				} catch {
					return 'Must be a valid URL';
				}
			},
		});
		if (p.isCancel(tokenUrl)) {
			p.cancel('Cancelled');
			return { success: false, error: 'Cancelled' };
		}

		const authorizationUrl = await p.text({
			message: 'Authorization URL',
			placeholder: 'https://oauth.example.com/authorize',
			validate: (value) => {
				if (!value?.trim()) return 'Authorization URL is required';
				try {
					new URL(value);
				} catch {
					return 'Must be a valid URL';
				}
			},
		});
		if (p.isCancel(authorizationUrl)) {
			p.cancel('Cancelled');
			return { success: false, error: 'Cancelled' };
		}

		const scopesInput = await p.text({
			message: 'Scopes (comma-separated)',
			placeholder: 'read,write,profile',
		});
		if (p.isCancel(scopesInput)) {
			p.cancel('Cancelled');
			return { success: false, error: 'Cancelled' };
		}
		const scopes = (scopesInput as string)
			.split(',')
			.map((s) => s.trim())
			.filter(Boolean);

		const scopeSeparator = await p.select({
			message: 'Scope separator',
			options: [
				{ value: ' ', label: 'Space' },
				{ value: ',', label: 'Comma' },
			],
		});
		if (p.isCancel(scopeSeparator)) {
			p.cancel('Cancelled');
			return { success: false, error: 'Cancelled' };
		}

		const scopeIdentifier = await p.text({
			message: 'Scope parameter name',
			placeholder: 'scope',
			initialValue: 'scope',
		});
		if (p.isCancel(scopeIdentifier)) {
			p.cancel('Cancelled');
			return { success: false, error: 'Cancelled' };
		}

		// Token params
		const needsOfflineAccess = await p.confirm({
			message: 'Require offline access (refresh tokens)?',
			initialValue: true,
		});
		if (p.isCancel(needsOfflineAccess)) {
			p.cancel('Cancelled');
			return { success: false, error: 'Cancelled' };
		}

		const tokenParams: Record<string, string> = {};
		const authorizationParams: Record<string, string> = {};
		if (needsOfflineAccess) {
			tokenParams.access_type = 'offline';
			tokenParams.prompt = 'consent';
			authorizationParams.access_type = 'offline';
			authorizationParams.prompt = 'consent';
		}

		spec.auth = {
			OAuth2: {
				token_url: tokenUrl as string,
				authorization_url: authorizationUrl as string,
				scopes,
				scope_identifier: scopeIdentifier as string,
				scope_separator: scopeSeparator as string,
				token_params: tokenParams,
				authorization_params: authorizationParams,
			},
		};
	} else {
		// API Key configuration
		const fields: AuthField[] = [
			{
				name: 'api_key',
				label: 'API Key',
				placeholder: `your-${slug}-api-key`,
				description: `Your ${name} API key`,
			},
		];

		// Ask if they want to add more fields
		let addMoreFields = await p.confirm({
			message: 'Add additional authentication fields?',
			initialValue: false,
		});
		if (p.isCancel(addMoreFields)) {
			p.cancel('Cancelled');
			return { success: false, error: 'Cancelled' };
		}

		while (addMoreFields) {
			const fieldName = await p.text({
				message: 'Field name (e.g., base_url)',
				validate: (value) => {
					if (!value?.trim()) return 'Field name is required';
				},
			});
			if (p.isCancel(fieldName)) {
				p.cancel('Cancelled');
				return { success: false, error: 'Cancelled' };
			}

			const fieldLabel = await p.text({
				message: 'Field label (displayed to user)',
				placeholder: 'Base URL',
			});
			if (p.isCancel(fieldLabel)) {
				p.cancel('Cancelled');
				return { success: false, error: 'Cancelled' };
			}

			const fieldPlaceholder = await p.text({
				message: 'Field placeholder',
				placeholder: 'https://api.example.com',
			});
			if (p.isCancel(fieldPlaceholder)) {
				p.cancel('Cancelled');
				return { success: false, error: 'Cancelled' };
			}

			const fieldDescription = await p.text({
				message: 'Field description',
				placeholder: 'The base URL for your instance',
			});
			if (p.isCancel(fieldDescription)) {
				p.cancel('Cancelled');
				return { success: false, error: 'Cancelled' };
			}

			fields.push({
				name: fieldName as string,
				label: (fieldLabel as string) || (fieldName as string),
				placeholder: (fieldPlaceholder as string) || '',
				description: (fieldDescription as string) || '',
			});

			addMoreFields = await p.confirm({
				message: 'Add another field?',
				initialValue: false,
			});
			if (p.isCancel(addMoreFields)) {
				p.cancel('Cancelled');
				return { success: false, error: 'Cancelled' };
			}
		}

		spec.auth = {
			api_key: { fields },
		};
	}

	// Show summary
	p.log.info('');
	p.note(
		[
			`${chalk.bold('Name:')} ${spec.name}`,
			`${chalk.bold('Slug:')} ${spec.key}`,
			`${chalk.bold('Description:')} ${spec.description}`,
			`${chalk.bold('Auth:')} ${authType === 'OAuth2' ? 'OAuth2' : 'API Key'}`,
			spec.schedule ? `${chalk.bold('Schedule:')} ${spec.schedule.frequency}` : '',
			`${chalk.bold('URL:')} ${url}`,
		]
			.filter(Boolean)
			.join('\n'),
		'Integration Summary',
	);

	const confirm = await p.confirm({
		message: 'Create this integration?',
		initialValue: true,
	});
	if (p.isCancel(confirm) || !confirm) {
		p.cancel('Cancelled');
		return { success: false, error: 'Cancelled' };
	}

	// Create integration via API
	const spinner = p.spinner();
	spinner.start('Creating integration...');

	try {
		const client = new CoreClient({
			baseUrl: config.auth.url,
			token: config.auth.apiKey,
		});

		const response = await fetch(`${config.auth.url}/api/v1/integration_definitions`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Authorization: `Bearer ${config.auth.apiKey}`,
			},
			body: JSON.stringify({
				name: spec.name,
				slug: spec.key,
				description: spec.description,
				icon: spec.icon,
				url: url as string,
				spec,
			}),
		});

		if (!response.ok) {
			const errorData = (await response.json()) as { error?: string };
			throw new Error(errorData.error || 'Failed to create integration');
		}

		const result = await response.json();
		spinner.stop(chalk.green('Integration created'));

		p.outro(chalk.green(`Successfully created integration "${spec.name}"`));
		return { success: true };
	} catch (error) {
		spinner.stop(chalk.red('Failed'));
		p.log.error(error instanceof Error ? error.message : 'Unknown error');
		return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
	}
}

export default function IntegrationsAdd(_props: Props) {
	const { exit } = useApp();

	useEffect(() => {
		runAddIntegration()
			.catch((err) => {
				p.log.error(err instanceof Error ? err.message : 'Unknown error');
			})
			.finally(() => {
				setTimeout(() => exit(), 100);
			});
	}, [exit]);

	return null;
}
