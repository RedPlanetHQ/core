import { useEffect, useState } from 'react';
import { Text } from 'ink';
import zod from 'zod';
import { ThemeContext } from '@/hooks/useTheme';
import { themeContextValue } from '@/config/themes';
import SuccessMessage from '@/components/success-message';
import ErrorMessage from '@/components/error-message';
import { isAgentBrowserInstalled, closeBrowser } from '@/utils/agent-browser';

export const options = zod.object({});

type Props = {
	options: zod.infer<typeof options>;
};

export default function BrowserClose(_props: Props) {
	const [status, setStatus] = useState<'checking' | 'closing' | 'success' | 'not-installed' | 'error'>('checking');
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

				if (!cancelled) {
					setStatus('closing');
				}

				const result = await closeBrowser();

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
	}, []);

	return (
		<ThemeContext.Provider value={themeContextValue}>
			{status === 'checking' ? (
				<Text dimColor>Checking agent-browser...</Text>
			) : status === 'not-installed' ? (
				<ErrorMessage message="agent-browser is not installed. Run `corebrain browser install` first." />
			) : status === 'closing' ? (
				<Text dimColor>Closing browser session...</Text>
			) : status === 'success' ? (
				<SuccessMessage message="Browser session closed" hideTitle />
			) : status === 'error' ? (
				<ErrorMessage message={`Failed to close browser: ${error}`} />
			) : null}
		</ThemeContext.Provider>
	);
}
