import { useEffect } from 'react';
import { useApp } from 'ink';
import * as p from '@clack/prompts';
import chalk from 'chalk';
import zod from 'zod';
import { exec } from 'node:child_process';
import { CoreClient } from '@redplanethq/sdk';
import { getConfig, updateConfig } from '@/config/index';

const DEFAULT_URL = 'https://app.getcore.me';
const POLL_INTERVAL_MS = 2000;
const POLL_TIMEOUT_MS = 300_000; // 5 minutes

function openBrowser(url: string): void {
	const command =
		process.platform === 'darwin'
			? `open "${url}"`
			: process.platform === 'win32'
				? `start "" "${url}"`
				: `xdg-open "${url}"`;

	exec(command, (error) => {
		if (error) {
			console.error('Failed to open browser:', error.message);
		}
	});
}

export const options = zod.object({});

type Props = {
	options: zod.infer<typeof options>;
};

async function runLogin(): Promise<{ success: boolean; error?: string }> {
	p.intro(chalk.bgCyan(chalk.black(' Login ')));

	const config = getConfig();

	// Step 1: Ask for host URL first
	const hostUrl = await p.text({
		message: 'Host URL',
		placeholder: DEFAULT_URL,
		initialValue: config.auth?.url || DEFAULT_URL,
	});

	if (p.isCancel(hostUrl)) {
		p.cancel('Login cancelled');
		return { success: false, error: 'Cancelled' };
	}

	const baseUrl = (hostUrl as string) || DEFAULT_URL;

	const spinner = p.spinner();

	// Step 2: Check if already authenticated
	spinner.start('Checking existing authentication...');
	if (config.auth?.apiKey && config.auth?.url === baseUrl) {
		try {
			const client = new CoreClient({
				baseUrl,
				token: config.auth.apiKey,
			});
			await client.checkAuth();
			spinner.stop(chalk.green('Already authenticated'));
			p.outro('Use a different command or clear your config to re-login.');
			return { success: true };
		} catch {
			// Token invalid or expired — proceed with login flow
		}
	}

	// Step 3: Request authorization code
	spinner.message('Requesting authorization code...');
	const client = new CoreClient({ baseUrl, token: '' });
	let authCode = '';
	let verifyUrl = '';
	try {
		const res = await client.getAuthorizationCode();
		authCode = res.authorizationCode!;
		const base64Token = Buffer.from(
			JSON.stringify({ authorizationCode: authCode, source: 'core-cli', clientName: 'core-cli' })
		).toString('base64');
		verifyUrl = `${baseUrl}/agent/verify/${base64Token}?source=core-cli`;
	} catch (err) {
		spinner.stop(chalk.red('Failed to get authorization code'));
		return {
			success: false,
			error: err instanceof Error ? err.message : 'Failed to get authorization code',
		};
	}

	spinner.stop(chalk.green('Authorization code received'));

	// Open browser and show URL
	p.log.info(`Opening browser to authorize...`);
	p.log.message(chalk.cyan(verifyUrl));
	openBrowser(verifyUrl);

	// Step 3: Poll for token
	spinner.start('Waiting for authorization...');
	const startedAt = Date.now();

	while (true) {
		if (Date.now() - startedAt > POLL_TIMEOUT_MS) {
			spinner.stop(chalk.red('Login timed out'));
			return { success: false, error: 'Login timed out after 5 minutes. Please try again.' };
		}

		await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));

		try {
			const tokenRes = await client.exchangeToken({ authorizationCode: authCode });
			if (tokenRes.token) {
				const pat = tokenRes.token.token!;
				updateConfig({
					auth: {
						url: baseUrl,
						apiKey: pat,
					},
				});
				spinner.stop(chalk.green('Authorization successful'));
				p.outro(chalk.green('Successfully logged in. Token saved to config.'));
				return { success: true };
			}
		} catch {
			// Token endpoint returned an error — keep polling
		}
	}
}

export default function Login(_props: Props) {
	const { exit } = useApp();

	useEffect(() => {
		runLogin()
			.catch((err) => {
				p.log.error(err instanceof Error ? err.message : 'Unknown error');
			})
			.finally(() => {
				setTimeout(() => exit(), 100);
			});
	}, [exit]);

	return null;
}
