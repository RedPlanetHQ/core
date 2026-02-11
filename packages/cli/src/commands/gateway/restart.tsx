import { useEffect, useState } from 'react';
import { Text } from 'ink';
import zod from 'zod';
import {
	getServiceType,
	getServiceName,
	isServiceInstalled,
	getServiceStatus,
	stopService,
	startService,
} from '@/utils/service-manager/index';
import SuccessMessage from '@/components/success-message';
import ErrorMessage from '@/components/error-message';
import { ThemeContext } from '@/hooks/useTheme';
import { themeContextValue } from '@/config/themes';

export const options = zod.object({});

type Props = {
	options: zod.infer<typeof options>;
};

export default function GatewayRestart(_props: Props) {
	const [status, setStatus] = useState<
		| 'checking'
		| 'stopping'
		| 'starting'
		| 'success'
		| 'not-installed'
		| 'unsupported'
		| 'error'
	>('checking');
	const [error, setError] = useState('');

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
						setStatus('not-installed');
					}
					return;
				}

				// Stop if running
				const serviceStatus = await getServiceStatus(serviceName);
				if (serviceStatus === 'running') {
					if (!cancelled) {
						setStatus('stopping');
					}
					await stopService(serviceName);
					await new Promise((resolve) => setTimeout(resolve, 1000));
				}

				// Start
				if (!cancelled) {
					setStatus('starting');
				}

				await startService(serviceName);
				await new Promise((resolve) => setTimeout(resolve, 1500));

				// Verify running
				const postStartStatus = await getServiceStatus(serviceName);
				if (postStartStatus !== 'running') {
					throw new Error('Service started but not running. Check logs: ~/.corebrain/logs/');
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
				<Text dimColor>Checking gateway status...</Text>
			) : status === 'stopping' ? (
				<Text dimColor>Stopping gateway...</Text>
			) : status === 'starting' ? (
				<Text dimColor>Starting gateway...</Text>
			) : status === 'unsupported' ? (
				<ErrorMessage message="Service management not supported on this platform." />
			) : status === 'not-installed' ? (
				<ErrorMessage message="Gateway not installed. Run: corebrain gateway on" hideTitle />
			) : status === 'success' ? (
				<SuccessMessage message="Gateway restarted" />
			) : status === 'error' ? (
				<ErrorMessage message={`Failed to restart: ${error}`} />
			) : null}
		</ThemeContext.Provider>
	);
}
