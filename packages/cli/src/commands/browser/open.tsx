import { useEffect, useState } from 'react';
import { Text } from 'ink';
import zod from 'zod';
import { ThemeContext } from '@/hooks/useTheme';
import { themeContextValue } from '@/config/themes';
import SuccessMessage from '@/components/success-message';
import ErrorMessage from '@/components/error-message';
import { isAgentBrowserInstalled, openUrl } from '@/utils/agent-browser';

export const args = zod.tuple([zod.string().describe('URL to open')]);

export const options = zod.object({
	headed: zod.boolean().optional().describe('Run browser in headed mode'),
	profile: zod.string().optional().describe('Browser profile to use'),
});

type Props = {
	args: zod.infer<typeof args>;
	options: zod.infer<typeof options>;
};

export default function BrowserOpen({ args: [url], options }: Props) {
	const [status, setStatus] = useState<'checking' | 'opening' | 'success' | 'not-installed' | 'error'>('checking');
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
					setStatus('opening');
				}

				const result = await openUrl(url, {
					headed: options.headed ?? true,
					profile: options.profile,
				});

				if (result.code !== 0) {
					throw new Error(result.stderr || 'Failed to open URL');
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
	}, [url, options.headed, options.profile]);

	return (
		<ThemeContext.Provider value={themeContextValue}>
			{status === 'checking' ? (
				<Text dimColor>Checking agent-browser...</Text>
			) : status === 'not-installed' ? (
				<ErrorMessage message="agent-browser is not installed. Run `corebrain browser install` first." />
			) : status === 'opening' ? (
				<Text dimColor>Opening {url}...</Text>
			) : status === 'success' ? (
				<SuccessMessage message={`Opened ${url}`} hideTitle />
			) : status === 'error' ? (
				<ErrorMessage message={`Failed to open URL: ${error}`} />
			) : null}
		</ThemeContext.Provider>
	);
}
