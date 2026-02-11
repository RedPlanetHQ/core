import { useEffect, useState } from 'react';
import { Text } from 'ink';
import zod from 'zod';
import { getPreferences, updatePreferences } from '@/config/preferences';
import {
	getServiceType,
	getServiceName,
	uninstallService,
	isServiceInstalled,
	stopService,
	getServiceStatus,
} from '@/utils/service-manager/index';
import SuccessMessage from '@/components/success-message';
import ErrorMessage from '@/components/error-message';
import { ThemeContext } from '@/hooks/useTheme';
import { themeContextValue } from '@/config/themes';

export const options = zod.object({});

type Props = {
	options: zod.infer<typeof options>;
};

export default function GatewayUninstall(_props: Props) {
	const [status, setStatus] = useState<
		| 'checking'
		| 'stopping'
		| 'uninstalling'
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
					// Clean up preferences if needed
					const prefs = getPreferences();
					if (prefs.gateway?.serviceInstalled) {
						const { gateway, ...rest } = prefs;
						updatePreferences(rest);
					}

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
					try {
						await stopService(serviceName);
						await new Promise((resolve) => setTimeout(resolve, 1000));
					} catch {
						// Continue anyway
					}
				}

				// Uninstall
				if (!cancelled) {
					setStatus('uninstalling');
				}

				await uninstallService(serviceName);

				// Clean up preferences
				const prefs = getPreferences();
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
				<Text dimColor>Checking service...</Text>
			) : status === 'stopping' ? (
				<Text dimColor>Stopping gateway...</Text>
			) : status === 'uninstalling' ? (
				<Text dimColor>Removing service...</Text>
			) : status === 'unsupported' ? (
				<ErrorMessage message="Service management not supported on this platform." />
			) : status === 'not-installed' ? (
				<ErrorMessage message="Gateway is not installed" hideTitle />
			) : status === 'success' ? (
				<SuccessMessage
					message="Gateway service removed.\n\nThe gateway will no longer auto-start.\nTo reinstall: corebrain gateway on"
				/>
			) : status === 'error' ? (
				<ErrorMessage message={`Failed to uninstall: ${error}`} />
			) : null}
		</ThemeContext.Provider>
	);
}
