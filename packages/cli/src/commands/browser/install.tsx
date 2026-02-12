import { useEffect, useState } from 'react';
import { Text } from 'ink';
import zod from 'zod';
import { ThemeContext } from '@/hooks/useTheme';
import { themeContextValue } from '@/config/themes';
import SuccessMessage from '@/components/success-message';
import ErrorMessage from '@/components/error-message';
import { isAgentBrowserInstalled, installAgentBrowser } from '@/utils/agent-browser';

export const options = zod.object({});

type Props = {
	options: zod.infer<typeof options>;
};

export default function BrowserInstall(_props: Props) {
	const [status, setStatus] = useState<'checking' | 'already-installed' | 'installing' | 'success' | 'error'>('checking');
	const [error, setError] = useState('');

	useEffect(() => {
		let cancelled = false;

		(async () => {
			try {
				const installed = await isAgentBrowserInstalled();

				if (installed) {
					if (!cancelled) {
						setStatus('already-installed');
					}
					return;
				}

				if (!cancelled) {
					setStatus('installing');
				}

				const result = await installAgentBrowser();

				if (result.code !== 0) {
					throw new Error(result.stderr || 'Installation failed');
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
				<Text dimColor>Checking if agent-browser is installed...</Text>
			) : status === 'already-installed' ? (
				<SuccessMessage message="agent-browser is already installed" hideTitle />
			) : status === 'installing' ? (
				<Text dimColor>Installing agent-browser globally via npm...</Text>
			) : status === 'success' ? (
				<SuccessMessage message="agent-browser installed successfully" />
			) : status === 'error' ? (
				<ErrorMessage message={`Failed to install agent-browser: ${error}`} />
			) : null}
		</ThemeContext.Provider>
	);
}
