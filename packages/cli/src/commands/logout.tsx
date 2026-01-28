import React, {useEffect, useState} from 'react';
import {Text} from 'ink';
import zod from 'zod';
import {getConfig, updateConfig} from '@/config/index';

export const options = zod.object({});

type Props = {
	options: zod.infer<typeof options>;
};

export default function Logout(_props: Props) {
	const [status, setStatus] = useState<
		'checking' | 'not-authenticated' | 'success' | 'error'
	>('checking');
	const [error, setError] = useState('');

	useEffect(() => {
		let cancelled = false;

		(async () => {
			const config = getConfig();

			// Check if already logged out
			if (!config.auth?.apiKey) {
				if (!cancelled) setStatus('not-authenticated');
				return;
			}

			try {
				// Remove auth from config
				updateConfig({auth: undefined});
				if (!cancelled) setStatus('success');
			} catch (err) {
				if (!cancelled) {
					setError(
						err instanceof Error
							? err.message
							: 'Failed to clear authentication',
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
		case 'checking':
			return <Text dimColor>Logging out...</Text>;

		case 'not-authenticated':
			return (
				<Text color="yellow">
					Already logged out. No authentication found in config.
				</Text>
			);

		case 'success':
			return (
				<Text color="green" bold>
					Successfully logged out. Authentication cleared from config.
				</Text>
			);

		case 'error':
			return <Text color="red">Error: {error}</Text>;

		default:
			return null;
	}
}
