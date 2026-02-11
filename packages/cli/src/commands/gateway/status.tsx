import { useEffect, useState } from 'react';
import { Text } from 'ink';
import zod from 'zod';
import { getPreferences } from '@/config/preferences';
import {
	getServiceType,
	getServiceName,
	isServiceInstalled,
	getServiceStatus,
} from '@/utils/service-manager/index';
import { getLaunchdServicePid } from '@/utils/service-manager/launchd';
import { getSystemdServicePid } from '@/utils/service-manager/systemd';
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
	installed: boolean;
	port?: number;
	pid?: number;
	startedAt?: number;
	uptime?: string;
	serviceType?: 'launchd' | 'systemd';
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
	const [status, setStatus] = useState<'loading' | 'ready' | 'unsupported'>('loading');
	const [gatewayStatus, setGatewayStatus] = useState<GatewayStatus>({
		running: false,
		installed: false,
	});

	useEffect(() => {
		let cancelled = false;

		(async () => {
			try {
				const serviceType = getServiceType();

				if (serviceType === 'none') {
					if (!cancelled) {
						setStatus('unsupported');
					}
					return;
				}

				const serviceName = getServiceName();
				const installed = await isServiceInstalled(serviceName);

				if (!installed) {
					if (!cancelled) {
						setGatewayStatus({ running: false, installed: false });
						setStatus('ready');
					}
					return;
				}

				const serviceStatus = await getServiceStatus(serviceName);
				const running = serviceStatus === 'running';

				// Get PID
				let pid: number | null = null;
				if (running) {
					if (serviceType === 'launchd') {
						pid = getLaunchdServicePid(serviceName);
					} else if (serviceType === 'systemd') {
						pid = getSystemdServicePid(serviceName);
					}
				}

				const prefs = getPreferences();

				if (!cancelled) {
					setGatewayStatus({
						running,
						installed: true,
						port: prefs.gateway?.port,
						pid: pid || undefined,
						startedAt: prefs.gateway?.startedAt,
						uptime: prefs.gateway?.startedAt
							? formatUptime(prefs.gateway.startedAt)
							: undefined,
						serviceType: serviceType === 'launchd' ? 'launchd' : 'systemd',
					});
					setStatus('ready');
				}
			} catch {
				if (!cancelled) {
					setGatewayStatus({ running: false, installed: false });
					setStatus('ready');
				}
			}
		})();

		return () => {
			cancelled = true;
		};
	}, []);

	const getServiceTypeLabel = () => {
		if (gatewayStatus.serviceType === 'launchd') return 'launchd (macOS)';
		if (gatewayStatus.serviceType === 'systemd') return 'systemd (Linux)';
		return 'unknown';
	};

	return (
		<ThemeContext.Provider value={themeContextValue}>
			{status === 'loading' ? (
				<Text dimColor>Checking gateway status...</Text>
			) : status === 'unsupported' ? (
				<ErrorMessage message="Service management not supported on this platform." />
			) : !gatewayStatus.installed ? (
				<ErrorMessage
					message="Gateway not installed.\n\nStart with: corebrain gateway on"
					hideTitle
				/>
			) : !gatewayStatus.running ? (
				<ErrorMessage
					message="Gateway installed but stopped.\n\nStart with: corebrain gateway on"
					hideTitle
				/>
			) : (
				<InfoMessage
					message={`Gateway: Running\n\nService: ${getServiceTypeLabel()}\nPort: ${gatewayStatus.port || 3456}\nPID: ${gatewayStatus.pid || 'unknown'}\nUptime: ${gatewayStatus.uptime || 'unknown'}\n\nAPI: http://localhost:${gatewayStatus.port || 3456}`}
				/>
			)}
		</ThemeContext.Provider>
	);
}
