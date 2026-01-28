import React, { useEffect, useState } from 'react';
import { Text } from 'ink';
import zod from 'zod';
import { exec } from 'node:child_process';
import { CoreClient } from '@redplanethq/sdk';
import { getConfig, updateConfig } from '@/config/index';

const BASE_URL = 'https://app.getcore.me';
const POLL_INTERVAL_MS = 2000;
const POLL_TIMEOUT_MS = 300_000; // 5 minutes

/**
 * Open URL in the default browser
 */
function openBrowser(url: string): void {
	const command =
		process.platform === 'darwin'
			? `open "${url}"`
			: process.platform === 'win32'
				? `start "" "${url}"`
				: `xdg-open "${url}"`;

	exec(command, (error) => {
		if (error) {
			// Silently fail - user can still copy the URL manually
			console.error('Failed to open browser:', error.message);
		}
	});
}

export const options = zod.object({});

type Props = {
	options: zod.infer<typeof options>;
};

export default function Login(_props: Props) {
	const [status, setStatus] = useState<
		| 'checking'
		| 'already-authenticated'
		| 'fetching-code'
		| 'waiting'
		| 'polling'
		| 'success'
		| 'error'
	>('checking');
	const [url, setUrl] = useState('');
	const [error, setError] = useState('');

	useEffect(() => {
		let cancelled = false;

		(async () => {
			// Step 1: Check if already authenticated
			const config = getConfig();
			if (config.auth?.apiKey) {
				try {
					const client = new CoreClient({
						baseUrl: config.auth.url || BASE_URL,
						token: config.auth.apiKey,
					});
					await client.checkAuth();
					if (!cancelled) setStatus('already-authenticated');
					return;
				} catch {
					// Token invalid or expired — proceed with login flow
				}
			}

			// Step 2: Request authorization code
			setStatus('fetching-code');
			const client = new CoreClient({ baseUrl: BASE_URL, token: '' });
			let authCode = '';
			let verifyUrl = '';
			try {
				const res = await client.getAuthorizationCode();
				authCode = res.authorizationCode!;
				const base64Token = Buffer.from(JSON.stringify({ token: authCode, source: 'core-cli', clientName: 'core-cli' }))
				verifyUrl = `${BASE_URL}/agent/verify/${base64Token}?source=core-cli`;
			} catch (err) {
				if (!cancelled) {
					setError(
						err instanceof Error ? err.message : 'Failed to get authorization code',
					);
					setStatus('error');
				}
				return;
			}

			if (!cancelled) {
				setUrl(verifyUrl);
				setStatus('polling');
				// Automatically open the URL in browser
				openBrowser(verifyUrl);
			}

			// Step 3: Poll for token
			const startedAt = Date.now();
			while (!cancelled) {
				if (Date.now() - startedAt > POLL_TIMEOUT_MS) {
					if (!cancelled) {
						setError('Login timed out after 5 minutes. Please try again.');
						setStatus('error');
					}
					return;
				}

				await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
				if (cancelled) break;

				try {
					const tokenRes = await client.exchangeToken({ authorizationCode: authCode });
					if (tokenRes.token) {
						const pat = tokenRes.token.token!;
						// Step 4: Persist token
						updateConfig({
							auth: {
								url: BASE_URL,
								apiKey: pat,
							},
						});
						if (!cancelled) setStatus('success');
						return;
					}
				} catch {
					// Token endpoint returned an error — keep polling
				}
			}
		})();

		return () => {
			cancelled = true;
		};
	}, []);

	switch (status) {
		case 'checking':
			return <Text dimColor>Checking existing authentication...</Text>;

		case 'already-authenticated':
			return (
				<Text color="green">
					Already authenticated. Use a different command or clear your config to
					re-login.
				</Text>
			);

		case 'fetching-code':
			return <Text dimColor>Requesting authorization code...</Text>;

		case 'polling':
			return (
				<>
					<Text color="green">
						Opening browser to authorize... If it doesn't open automatically, visit:
					</Text>
					<Text color="cyan">{url}</Text>
					<Text dimColor>Waiting for authorization...</Text>
				</>
			);

		case 'success':
			return (
				<Text color="green" bold>
					Successfully logged in. Token saved to config.
				</Text>
			);

		case 'error':
			return <Text color="red">{error}</Text>;

		default:
			return null;
	}
}
