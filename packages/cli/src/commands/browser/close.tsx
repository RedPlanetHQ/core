import { useEffect, useState } from 'react';
import { Text } from 'ink';
import zod from 'zod';
import { ThemeContext } from '@/hooks/useTheme';
import { themeContextValue } from '@/config/themes';
import SuccessMessage from '@/components/success-message';
import ErrorMessage from '@/components/error-message';
import { isAgentBrowserInstalled, browserClose, getSession } from '@/utils/agent-browser';

export const args = zod.tuple([
	zod.string().describe('Session name to close'),
]);

export const options = zod.object({});

type Props = {
	args: zod.infer<typeof args>;
	options: zod.infer<typeof options>;
};

export default function BrowserClose({ args: [sessionName] }: Props) {
	const [status, setStatus] = useState<'checking' | 'closing' | 'success' | 'not-installed' | 'not-found' | 'error'>('checking');
	const [error, setError] = useState('');

	useEffect(() => {
		let cancelled = false;

		(async () => {
			try {
				const installed = await isAgentBrowserInstalled();

				if (!installed) {
					if (!cancelled) {
						setStatus('not-installed');
					}
					return;
				}

				// Check if session exists
				const session = getSession(sessionName);
				if (!session) {
					if (!cancelled) {
						setStatus('not-found');
					}
					return;
				}

				if (!cancelled) {
					setStatus('closing');
				}

				const result = await browserClose(sessionName);

				if (result.code !== 0) {
					throw new Error(result.stderr || 'Failed to close browser');
				}

				if (!cancelled) {
					setStatus('success');
				}
			} catch (err) {
				if (!cancelled) {
					setError(err instanceof Error ? err.message : 'Unknown error');
					setStatus('error');
				}
			}
		})();

		return () => {
			cancelled = true;
		};
	}, [sessionName]);

	return (
		<ThemeContext.Provider value={themeContextValue}>
			{status === 'checking' ? (
				<Text dimColor>Checking agent-browser...</Text>
			) : status === 'not-installed' ? (
				<ErrorMessage message="agent-browser is not installed. Run `corebrain browser install` first." />
			) : status === 'not-found' ? (
				<ErrorMessage message={`Session "${sessionName}" not found. Use \`corebrain browser status\` to see active sessions.`} />
			) : status === 'closing' ? (
				<Text dimColor>Closing session "{sessionName}"...</Text>
			) : status === 'success' ? (
				<SuccessMessage message={`Closed session "${sessionName}"`} hideTitle />
			) : status === 'error' ? (
				<ErrorMessage message={`Failed to close browser: ${error}`} />
			) : null}
		</ThemeContext.Provider>
	);
}
