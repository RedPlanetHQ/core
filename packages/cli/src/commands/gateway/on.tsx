import { useEffect, useState } from 'react';
import { Text } from 'ink';
import zod from 'zod';
import { getConfig } from '@/config/index';
import { getPreferences, updatePreferences } from '@/config/preferences';
import SuccessMessage from '@/components/success-message';
import ErrorMessage from '@/components/error-message';
import { ThemeContext } from '@/hooks/useTheme';
import { themeContextValue } from '@/config/themes';
import { getConfigPath } from '@/config/paths';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	installService,
	getServiceStatus,
	startService,
	getServiceName,
	getServiceType,
	getServicePid,
} from '@/utils/service-manager';
import type { ServiceConfig } from '@/utils/service-manager';

export const options = zod.object({});

type Props = {
	options: zod.infer<typeof options>;
};

// Get the path to the gateway-entry.js script
function getGatewayEntryPath(): string {
	// Get the directory of this file
	const __filename = fileURLToPath(import.meta.url);
	const __dirname = dirname(__filename);
	// Navigate from dist/commands/gateway to dist/server/gateway-entry.js
	return join(__dirname, '..', '..', 'server', 'gateway-entry.js');
}

export default function GatewayOn(_props: Props) {
	const [status, setStatus] = useState<
		| 'checking'
		| 'not-authenticated'
		| 'not-configured'
		| 'not-supported'
		| 'installing'
		| 'starting'
		| 'started'
		| 'error'
	>('checking');
	const [error, setError] = useState('');
	const [exitCode, setExitCode] = useState<number | undefined>(undefined);

	useEffect(() => {
		let cancelled = false;

		(async () => {
			try {
				// Check platform support
				const serviceType = getServiceType();
				if (serviceType === 'none') {
					if (!cancelled) {
						setStatus('not-supported');
						setExitCode(1);
					}
					return;
				}

				// Check if authenticated
				const config = getConfig();


				if (!config.auth?.apiKey || !config.auth?.url) {
					if (!cancelled) {
						setStatus('not-authenticated');
						setExitCode(1);
					}
					return;
				}

				// Check if gateway is configured
				const prefs = getPreferences();
				if (!prefs.gateway?.id || !prefs.gateway?.name) {
					if (!cancelled) {
						setStatus('not-configured');
						setExitCode(1);
					}
					return;
				}

				const serviceName = getServiceName();

				// Check if already running
				const currentStatus = await getServiceStatus(serviceName);
				if (currentStatus === 'running') {
					if (!cancelled) {
						setStatus('started');
						setExitCode(0);
					}
					return;
				}

				// Install/update the service
				if (!cancelled) {
					setStatus('installing');
				}

				const gatewayEntryPath = getGatewayEntryPath();
				const logDir = join(getConfigPath(), 'logs');

				const serviceConfig: ServiceConfig = {
					name: serviceName,
					displayName: 'CoreBrain Gateway',
					command: process.execPath, // Node.js path
					args: [gatewayEntryPath], // No longer passing name/description as args
					port: 0, // Not applicable for WebSocket client
					workingDirectory: homedir(),
					logPath: join(logDir, 'gateway-stdout.log'),
					errorLogPath: join(logDir, 'gateway-stderr.log'),
				};

				await installService(serviceConfig);

				// Start the service
				if (!cancelled) {
					setStatus('starting');
				}

				await startService(serviceName);

				// Wait a moment for the service to start and get the PID
				await new Promise(resolve => setTimeout(resolve, 500));
				const pid = getServicePid(serviceName);

				// Update preferences with actual PID
				updatePreferences({
					gateway: {
						...getPreferences().gateway,
						port: 0,
						pid: pid ?? 0,
						startedAt: Date.now(),
						serviceInstalled: true,
						serviceType: serviceType,
						serviceName: serviceName,
					},
				});

				if (!cancelled) {
					setStatus('started');
					setExitCode(0);
				}
			} catch (err) {
				if (!cancelled) {
					setError(err instanceof Error ? err.message : 'Unknown error');
					setStatus('error');
					setExitCode(1);
				}
			}
		})();

		return () => {
			cancelled = true;
		};
	}, []);

	// Exit after showing result
	useEffect(() => {
		if (exitCode !== undefined) {
			const timer = setTimeout(() => {
				process.exit(exitCode);
			}, 100);
			return () => clearTimeout(timer);
		}
	}, [exitCode]);

	return (
		<ThemeContext.Provider value={themeContextValue}>
			{status === 'checking' ? (
				<Text dimColor>Checking configuration...</Text>
			) : status === 'not-authenticated' ? (
				<ErrorMessage message="Not authenticated. Run `corebrain login` first." />
			) : status === 'not-configured' ? (
				<ErrorMessage message="Gateway not configured. Run `corebrain gateway config` first." />
			) : status === 'not-supported' ? (
				<ErrorMessage message="Service management not supported on this platform. Only macOS (launchd) and Linux (systemd) are supported." />
			) : status === 'installing' ? (
				<Text dimColor>Installing gateway service...</Text>
			) : status === 'starting' ? (
				<Text dimColor>Starting gateway service...</Text>
			) : status === 'started' ? (
				<SuccessMessage
					message={`Gateway service started\n\nThe gateway is now running in the background.\nUse 'corebrain gateway status' to check status.\nUse 'corebrain gateway off' to stop.`}
				/>
			) : status === 'error' ? (
				<ErrorMessage message={`Gateway error: ${error}`} />
			) : null}
		</ThemeContext.Provider>
	);
}
