import { useEffect, useState } from 'react';
import { Text } from 'ink';
import zod from 'zod';
import { getPreferences, updatePreferences } from '@/config/preferences';
import {
	getServiceType,
	getServiceName,
	isServiceInstalled,
	getServiceStatus,
	startService,
	installService,
	type ServiceConfig,
} from '@/utils/service-manager/index';
import SuccessMessage from '@/components/success-message';
import ErrorMessage from '@/components/error-message';
import { ThemeContext } from '@/hooks/useTheme';
import { themeContextValue } from '@/config/themes';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { existsSync, realpathSync, mkdirSync, readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const DEFAULT_PORT = 3456;
const COREBRAIN_DIR = join(homedir(), '.corebrain');
const LOGS_DIR = join(COREBRAIN_DIR, 'logs');

export const options = zod.object({
	port: zod.number().optional().describe('Port for the gateway server'),
});

type Props = {
	options: zod.infer<typeof options>;
};

// Helper to read last N lines from a file
function readLastLines(filePath: string, lines: number = 5): string {
	try {
		if (!existsSync(filePath)) return '';
		const content = readFileSync(filePath, 'utf-8');
		const allLines = content.trim().split('\n');
		return allLines.slice(-lines).join('\n');
	} catch {
		return '';
	}
}

export default function GatewayOn({ options }: Props) {
	const [status, setStatus] = useState<
		| 'checking'
		| 'installing'
		| 'starting'
		| 'success'
		| 'already-running'
		| 'unsupported'
		| 'error'
	>('checking');
	const [error, setError] = useState('');
	const [port, setPort] = useState(options.port || DEFAULT_PORT);
	const [serviceTypeLabel, setServiceTypeLabel] = useState('');

	useEffect(() => {
		let cancelled = false;

		(async () => {
			try {
				// Check platform support
				const serviceType = getServiceType();

				if (serviceType === 'none') {
					if (!cancelled) {
						setStatus('unsupported');
					}
					return;
				}

				setServiceTypeLabel(serviceType === 'launchd' ? 'launchd (macOS)' : 'systemd (Linux)');

				const serviceName = getServiceName();
				const installed = await isServiceInstalled(serviceName);

				// If already installed, check if running
				if (installed) {
					const serviceStatus = await getServiceStatus(serviceName);

					if (serviceStatus === 'running') {
						const prefs = getPreferences();
						if (prefs.gateway?.port) {
							setPort(prefs.gateway.port);
						}
						if (!cancelled) {
							setStatus('already-running');
						}
						return;
					}

					// Service installed but not running - start it
					if (!cancelled) {
						setStatus('starting');
					}

					await startService(serviceName);
					await new Promise((resolve) => setTimeout(resolve, 1500));

					const postStartStatus = await getServiceStatus(serviceName);
					if (postStartStatus === 'running') {
						if (!cancelled) {
							setStatus('success');
						}
					} else {
						throw new Error('Service started but not running. Check logs: ~/.corebrain/logs/');
					}
					return;
				}

				// Not installed - install and start
				if (!cancelled) {
					setStatus('installing');
				}

				// Find CLI path
				let cliPath: string | null = null;
				const possiblePaths = [
					join(process.execPath.replace('/bin/node', ''), 'lib/node_modules/@redplanethq/corebrain/dist/cli.js'),
					join(process.cwd(), 'packages/cli/dist/cli.js'),
				];

				for (const p of possiblePaths) {
					if (existsSync(p)) {
						cliPath = realpathSync(p);
						break;
					}
				}

				if (!cliPath && process.argv[1] && existsSync(process.argv[1])) {
					cliPath = realpathSync(process.argv[1]);
				}

				if (!cliPath) {
					throw new Error(
						`Could not locate corebrain CLI.\n\nSearched:\n${possiblePaths.map(p => `  - ${p}`).join('\n')}`,
					);
				}

				// Ensure logs directory exists
				if (!existsSync(LOGS_DIR)) {
					mkdirSync(LOGS_DIR, { recursive: true });
				}

				// Create service config
				const config: ServiceConfig = {
					name: serviceName,
					displayName: 'Corebrain Gateway Server',
					command: process.execPath,
					args: [cliPath, 'server', '--port', String(port)],
					port,
					workingDirectory: homedir(),
					logPath: join(LOGS_DIR, 'gateway.log'),
					errorLogPath: join(LOGS_DIR, 'gateway.error.log'),
				};

				await installService(config);
				await new Promise((resolve) => setTimeout(resolve, 2000));

				const postInstallStatus = await getServiceStatus(serviceName);

				// Update preferences
				updatePreferences({
					gateway: {
						port,
						pid: 0,
						startedAt: Date.now(),
						serviceInstalled: true,
						serviceType: serviceType === 'launchd' ? 'launchd' : 'systemd',
						serviceName,
					},
				});

				if (postInstallStatus === 'running') {
					if (!cancelled) {
						setStatus('success');
					}
				} else {
					// Gather error info
					const errorLog = readLastLines(join(LOGS_DIR, 'gateway.error.log'));
					const debugCmd = serviceType === 'launchd'
						? 'launchctl list | grep corebrain'
						: 'systemctl --user status corebrain-gateway';

					throw new Error(
						`Service installed but failed to start.\n\nDebug: ${debugCmd}\nLogs: ~/.corebrain/logs/\n${errorLog ? `\nError output:\n${errorLog}` : ''}`,
					);
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
	}, [port]);

	return (
		<ThemeContext.Provider value={themeContextValue}>
			{status === 'checking' ? (
				<Text dimColor>Checking gateway status...</Text>
			) : status === 'installing' ? (
				<Text dimColor>Installing gateway as {serviceTypeLabel} service...</Text>
			) : status === 'starting' ? (
				<Text dimColor>Starting gateway service...</Text>
			) : status === 'unsupported' ? (
				<ErrorMessage
					message={`Service management not supported on this platform.\n\nSupported: macOS (launchd), Linux (systemd)`}
				/>
			) : status === 'already-running' ? (
				<SuccessMessage
					message={`Gateway already running on port ${port}`}
					hideTitle
				/>
			) : status === 'success' ? (
				<SuccessMessage
					message={`Gateway started on port ${port}\n\nFeatures:\n  - Auto-starts on login\n  - Auto-restarts on crash\n\nAPI: http://localhost:${port}`}
				/>
			) : status === 'error' ? (
				<ErrorMessage message={`Failed to start gateway: ${error}`} />
			) : null}
		</ThemeContext.Provider>
	);
}
