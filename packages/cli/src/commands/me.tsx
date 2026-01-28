import React, {useEffect, useState} from 'react';
import {Text} from 'ink';
import zod from 'zod';
import {CoreClient, type MeResponse} from '@redplanethq/sdk';
import {getConfig} from '@/config/index';

const BASE_URL = 'https://app.getcore.me';

export const options = zod.object({});

type Props = {
	options: zod.infer<typeof options>;
};

export default function Me(_props: Props) {
	const [status, setStatus] = useState<
		'loading' | 'success' | 'not-authenticated' | 'error'
	>('loading');
	const [user, setUser] = useState<MeResponse | null>(null);
	const [error, setError] = useState('');

	useEffect(() => {
		let cancelled = false;

		(async () => {
			const config = getConfig();
			const apiKey = config.auth?.apiKey;
			const url = config.auth?.url;

			if (!apiKey) {
				if (!cancelled) setStatus('not-authenticated');
				return;
			}

			try {
				const client = new CoreClient({
					baseUrl: url || BASE_URL,
					token: apiKey,
				});
				const response = await client.me();
				if (!cancelled) {
					setUser(response);
					setStatus('success');
				}
			} catch (err) {
				if (!cancelled) {
					setError(
						err instanceof Error ? err.message : 'Failed to fetch user info',
					);
					setStatus('error');
				}
			}
		})();

		return () => {
			cancelled = true;
		};
	}, []);

	switch (status) {
		case 'loading':
			return <Text dimColor>Fetching user info...</Text>;

		case 'not-authenticated':
			return (
				<Text color="red">
					Not authenticated. Please run the login command first.
				</Text>
			);

		case 'success':
			return (
				<>
					<Text color="green" bold>
						Name: {user?.name || 'Not set'}
					</Text>
					{user?.email && <Text dimColor>Email: {user.email}</Text>}
					{user?.workspaceId && (
						<Text dimColor>Workspace ID: {user.workspaceId}</Text>
					)}
				</>
			);

		case 'error':
			return <Text color="red">Error: {error}</Text>;

		default:
			return null;
	}
}
