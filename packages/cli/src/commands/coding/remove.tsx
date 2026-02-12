import {useEffect, useState} from 'react';
import {Text} from 'ink';
import zod from 'zod';
import {getPreferences, updatePreferences} from '@/config/preferences';
import SuccessMessage from '@/components/success-message';
import ErrorMessage from '@/components/error-message';
import {ThemeContext} from '@/hooks/useTheme';
import {themeContextValue} from '@/config/themes';
import type {CliBackendConfig} from '@/types/config';

export const options = zod.object({
	agent: zod.string().describe('Agent name to remove'),
});

type Props = {
	options: zod.infer<typeof options>;
};

export default function CodingRemove({options: opts}: Props) {
	const [status, setStatus] = useState<'loading' | 'removed' | 'not-found' | 'error'>('loading');
	const [error, setError] = useState('');

	const agentName = opts.agent;

	useEffect(() => {
		try {
			const prefs = getPreferences();
			const coding = (prefs.coding || {}) as Record<string, CliBackendConfig>;

			if (!coding[agentName]) {
				setStatus('not-found');
				return;
			}

			// Remove the agent
			delete coding[agentName];
			updatePreferences({coding});

			setStatus('removed');
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Unknown error');
			setStatus('error');
		}
	}, [agentName]);

	return (
		<ThemeContext.Provider value={themeContextValue}>
			{status === 'loading' ? (
				<Text dimColor>Removing agent configuration...</Text>
			) : status === 'error' ? (
				<ErrorMessage message={`Error: ${error}`} />
			) : status === 'not-found' ? (
				<ErrorMessage message={`Agent "${agentName}" not found.`} hideTitle />
			) : status === 'removed' ? (
				<SuccessMessage message={`Removed "${agentName}" configuration.`} />
			) : null}
		</ThemeContext.Provider>
	);
}
