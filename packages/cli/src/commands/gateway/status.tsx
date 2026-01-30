import { useEffect, useState } from 'react';
import { Text } from 'ink';
import zod from 'zod';
import { getPreferences } from '@/config/preferences';
import { isPidRunning } from '@/utils/process';
import InfoMessage from '@/components/info-message';
import ErrorMessage from '@/components/error-message';
import { ThemeContext } from '@/hooks/useTheme';
import { themeContextValue } from '@/config/themes';

export const options = zod.object({});

type Props = {
	options: zod.infer<typeof options>;
};

interface GatewayStatus {
	running: boolean;
	port?: number;
	pid?: number;
	startedAt?: number;
	uptime?: string;
}

function formatUptime(startedAt: number): string {
	const uptimeMs = Date.now() - startedAt;
	const seconds = Math.floor(uptimeMs / 1000);
	const minutes = Math.floor(seconds / 60);
	const hours = Math.floor(minutes / 60);
	const days = Math.floor(hours / 24);

	if (days > 0) return `${days}d ${hours % 24}h`;
	if (hours > 0) return `${hours}h ${minutes % 60}m`;
	if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
	return `${seconds}s`;
}

export default function GatewayStatus(_props: Props) {
	const [status, setStatus] = useState<'loading' | 'ready'>('loading');
	const [gatewayStatus, setGatewayStatus] = useState<GatewayStatus>({
		running: false,
	});

	useEffect(() => {
		let cancelled = false;

		(async () => {
			try {
				const prefs = getPreferences();

				if (!prefs.gateway?.pid) {
					if (!cancelled) {
						setGatewayStatus({ running: false });
						setStatus('ready');
					}
					return;
				}

				const running = isPidRunning(prefs.gateway.pid);

				if (!cancelled) {
					setGatewayStatus({
						running,
						port: prefs.gateway.port,
						pid: prefs.gateway.pid,
						startedAt: prefs.gateway.startedAt,
						uptime: prefs.gateway.startedAt
							? formatUptime(prefs.gateway.startedAt)
							: undefined,
					});
					setStatus('ready');
				}
			} catch (err) {
				if (!cancelled) {
					setGatewayStatus({ running: false });
					setStatus('ready');
				}
			}
		})();

		return () => {
			cancelled = true;
		};
	}, []);

	return (
		<ThemeContext.Provider value={themeContextValue}>
			{status === 'loading' ? (
				<Text dimColor>Checking gateway status...</Text>
			) : !gatewayStatus.running ? (
				<ErrorMessage message="Gateway is not running" hideTitle />
			) : (
				<InfoMessage
					message={`Gateway Status: Running\n\nPort: ${gatewayStatus.port}\nPID: ${gatewayStatus.pid}\nUptime: ${gatewayStatus.uptime || 'unknown'}\n\nAPI Base URL: http://localhost:${gatewayStatus.port}\n\nEndpoints:\n  POST   /sessions          Create new session\n  GET    /sessions          List all sessions\n  GET    /sessions/:id      Get session details\n  DELETE /sessions/:id      Kill session`}
				/>
			)}
		</ThemeContext.Provider>
	);
}
