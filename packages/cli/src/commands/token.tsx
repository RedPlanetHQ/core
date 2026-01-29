import React, { useEffect, useState } from 'react';
import { Text } from 'ink';
import zod from 'zod';
import { getConfig } from '@/config/index';

export const options = zod.object({});

type Props = {
	options: zod.infer<typeof options>;
};

export default function Token(_props: Props) {
	const [status, setStatus] = useState<'loading' | 'found' | 'not-authenticated'>('loading');
	const [token, setToken] = useState('');

	useEffect(() => {
		const config = getConfig();
		const apiKey = config.auth?.apiKey;

		if (!apiKey) {
			setStatus('not-authenticated');
			return;
		}

		setToken(apiKey);
		setStatus('found');
	}, []);

	switch (status) {
		case 'loading':
			return <Text dimColor>Reading token...</Text>;

		case 'not-authenticated':
			return (
				<Text color="red">
					Not authenticated. Please run the login command first.
				</Text>
			);

		case 'found':
			return <Text>{token}</Text>;

		default:
			return null;
	}
}
