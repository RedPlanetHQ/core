import { useEffect, useState } from 'react';
import { Text } from 'ink';
import zod from 'zod';
import { getConfig } from '@/config/index';
import { getPreferences, updatePreferences } from '@/config/preferences';
import SuccessMessage from '@/components/success-message';
import ErrorMessage from '@/components/error-message';
import { ThemeContext } from '@/hooks/useTheme';
import { themeContextValue } from '@/config/themes';
import { hostname } from 'node:os';
import { createGatewayClient, type GatewayClient } from '@/server/gateway-client';

export const options = zod.object({
	name: zod.string().optional().describe('Gateway name'),
	description: zod.string().optional().describe('Gateway description'),
});

type Props = {
	options: zod.infer<typeof options>;
};

export default function GatewayOn({ options }: Props) {
	const [status, setStatus] = useState<
		| 'checking'
		| 'not-authenticated'
		| 'connecting'
		| 'connected'
		| 'ready'
		| 'error'
	>('checking');
	const [error, setError] = useState('');
	const [gatewayId, setGatewayId] = useState<string | null>(null);
	const [client, setClient] = useState<GatewayClient | null>(null);

	useEffect(() => {
		let cancelled = false;
		let gatewayClient: GatewayClient | null = null;

		(async () => {
			try {
				// Check if authenticated
				const config = getConfig();

				if (!config.auth?.apiKey || !config.auth?.url) {
					if (!cancelled) {
						setStatus('not-authenticated');
					}
					return;
				}

				// Get gateway name
				const gatewayName = options.name || `${hostname()}-browser`;
				const gatewayDescription = options.description || 'Browser automation gateway';

				if (!cancelled) {
					setStatus('connecting');
				}

				// Create and connect gateway client
				gatewayClient = createGatewayClient({
					url: config.auth.url,
					apiKey: config.auth.apiKey,
					name: gatewayName,
					description: gatewayDescription,
					onConnect: () => {
						if (!cancelled) {
							setStatus('connected');
						}
					},
					onReady: (id) => {
						if (!cancelled) {
							setGatewayId(id);
							setStatus('ready');

							// Update preferences
							updatePreferences({
								gateway: {
									...getPreferences().gateway,
									port: 0, // No HTTP port for WebSocket mode
									pid: process.pid,
									startedAt: Date.now(),
								},
							});
						}
					},
					onDisconnect: () => {
						if (!cancelled) {
							setStatus('connecting');
						}
					},
					onError: (err) => {
						if (!cancelled) {
							setError(err.message);
							setStatus('error');
						}
					},
				});

				setClient(gatewayClient);
			} catch (err) {
				if (!cancelled) {
					setError(err instanceof Error ? err.message : 'Unknown error');
					setStatus('error');
				}
			}
		})();

		return () => {
			cancelled = true;
			if (gatewayClient) {
				gatewayClient.disconnect();
			}
		};
	}, [options.name, options.description]);

	// Keep process running while connected
	useEffect(() => {
		if (status === 'ready' || status === 'connected' || status === 'connecting') {
			// Prevent process from exiting
			const interval = setInterval(() => {
				// Keep alive
			}, 1000);

			return () => {
				clearInterval(interval);
			};
		}
	}, [status]);

	return (
		<ThemeContext.Provider value={themeContextValue}>
			{status === 'checking' ? (
				<Text dimColor>Checking configuration...</Text>
			) : status === 'not-authenticated' ? (
				<ErrorMessage message="Not authenticated. Run `corebrain login` first." />
			) : status === 'connecting' ? (
				<Text dimColor>Connecting to gateway...</Text>
			) : status === 'connected' ? (
				<Text dimColor>Connected, registering tools...</Text>
			) : status === 'ready' ? (
				<SuccessMessage
					message={`Gateway connected\n\nGateway ID: ${gatewayId}\nTools: browser_open, browser_click, browser_fill, browser_type, browser_screenshot, browser_snapshot, browser_get_text, browser_get_url, browser_wait, browser_scroll, browser_hover, browser_close\n\nPress Ctrl+C to disconnect`}
				/>
			) : status === 'error' ? (
				<ErrorMessage message={`Gateway error: ${error}`} />
			) : null}
		</ThemeContext.Provider>
	);
}
