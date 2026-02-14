import { useEffect, useState } from 'react';
import { Text } from 'ink';
import zod from 'zod';
import {
	getServiceType,
	getServiceName,
	isServiceInstalled,
	getServiceStatus,
	stopService,
} from '@/utils/service-manager/index';
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
		| 'not-installed'
		| 'unsupported'
		| 'error'
	>('checking');
	const [error, setError] = useState('');

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

				const serviceName = getServiceName();
				const installed = await isServiceInstalled(serviceName);

				if (!installed) {
					if (!cancelled) {
						setStatus('not-installed');
					}
					return;
				}

				// Check if running
				const serviceStatus = await getServiceStatus(serviceName);

				if (serviceStatus !== 'running') {
					if (!cancelled) {
						setStatus('not-running');
					}
					return;
				}

				// Stop the service
				if (!cancelled) {
					setStatus('stopping');
				}

				await stopService(serviceName);
				await new Promise((resolve) => setTimeout(resolve, 1000));

				// Verify stopped
				const postStopStatus = await getServiceStatus(serviceName);
				if (postStopStatus === 'running') {
					throw new Error('Stop command sent but service is still running');
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
			) : status === 'unsupported' ? (
				<ErrorMessage message="Service management not supported on this platform." />
			) : status === 'not-installed' ? (
				<ErrorMessage message="Gateway is not installed. Run: corebrain gateway on" hideTitle />
			) : status === 'not-running' ? (
				<ErrorMessage message="Gateway is not running" hideTitle />
			) : status === 'success' ? (
				<SuccessMessage
					message={`Gateway stopped.\n\nNote: Will auto-start on next login.\nTo remove completely: corebrain gateway uninstall`}
				/>
			) : status === 'error' ? (
				<ErrorMessage message={`Failed to stop gateway: ${error}`} />
			) : null}
		</ThemeContext.Provider>
	);
}
