import React, { useEffect, useState } from 'react';
import { Text } from 'ink';
import zod from 'zod';
import { getPreferences, updatePreferences } from '@/config/preferences';
import { killProcessAndWait, isPidRunning } from '@/utils/process';
import SuccessMessage from '@/components/success-message';
import ErrorMessage from '@/components/error-message';
import { ThemeContext } from '@/hooks/useTheme';
import { themeContextValue } from '@/config/themes';

export const options = zod.object({});

type Props = {
	options: zod.infer<typeof options>;
};

export default function GatewayOff(_props: Props) {
	const [status, setStatus] = useState<
		| 'checking'
		| 'stopping'
		| 'success'
		| 'not-running'
		| 'error'
	>('checking');
	const [error, setError] = useState('');

	useEffect(() => {
		let cancelled = false;

		(async () => {
			try {
				// Check if gateway is running
				const prefs = getPreferences();
				if (!prefs.gateway?.pid) {
					if (!cancelled) {
						setStatus('not-running');
					}
					return;
				}

				const running = isPidRunning(prefs.gateway.pid);
				if (!running) {
					// Clean up stale config
					const { gateway, ...rest } = prefs;
					updatePreferences(rest);
					if (!cancelled) {
						setStatus('not-running');
					}
					return;
				}

				// Stop the gateway
				setStatus('stopping');
				const killed = await killProcessAndWait(prefs.gateway.pid);

				if (!killed) {
					if (!cancelled) {
						setError(`Failed to kill process ${prefs.gateway.pid}. It may require manual cleanup.`);
						setStatus('error');
					}
					return;
				}

				// Clean up config
				const { gateway, ...rest } = prefs;
				updatePreferences(rest);

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
				<Text dimColor>Checking gateway status...</Text>
			) : status === 'stopping' ? (
				<Text dimColor>Stopping gateway server...</Text>
			) : status === 'not-running' ? (
				<ErrorMessage message="Gateway is not running" hideTitle />
			) : status === 'success' ? (
				<SuccessMessage message="Gateway server stopped successfully" />
			) : status === 'error' ? (
				<ErrorMessage message={`Failed to stop gateway: ${error}`} />
			) : null}
		</ThemeContext.Provider>
	);
}
