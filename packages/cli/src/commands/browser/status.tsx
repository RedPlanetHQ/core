import { useEffect, useState } from 'react';
import { Text, Box } from 'ink';
import zod from 'zod';
import { ThemeContext } from '@/hooks/useTheme';
import { themeContextValue } from '@/config/themes';
import ErrorMessage from '@/components/error-message';
import { isAgentBrowserInstalled, getSessionStatus, listProfiles, getSessionName } from '@/utils/agent-browser';

export const options = zod.object({});

type Props = {
	options: zod.infer<typeof options>;
};

interface StatusInfo {
	installed: boolean;
	sessionStatus: 'running' | 'stopped' | 'unknown';
	profiles: string[];
}

export default function BrowserStatus(_props: Props) {
	const [status, setStatus] = useState<'checking' | 'ready' | 'error'>('checking');
	const [info, setInfo] = useState<StatusInfo | null>(null);
	const [error, setError] = useState('');

	useEffect(() => {
		let cancelled = false;

		(async () => {
			try {
				const installed = await isAgentBrowserInstalled();
				let sessionStatus: 'running' | 'stopped' | 'unknown' = 'unknown';

				if (installed) {
					sessionStatus = await getSessionStatus();
				}

				const profiles = listProfiles();

				if (!cancelled) {
					setInfo({ installed, sessionStatus, profiles });
					setStatus('ready');
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

	if (status === 'checking') {
		return (
			<ThemeContext.Provider value={themeContextValue}>
				<Text dimColor>Checking browser status...</Text>
			</ThemeContext.Provider>
		);
	}

	if (status === 'error') {
		return (
			<ThemeContext.Provider value={themeContextValue}>
				<ErrorMessage message={error} />
			</ThemeContext.Provider>
		);
	}

	if (!info) {
		return null;
	}

	const sessionName = getSessionName();

	return (
		<ThemeContext.Provider value={themeContextValue}>
			<Box flexDirection="column" gap={1}>
				<Box>
					<Text bold>Browser Status</Text>
				</Box>

				<Box flexDirection="column">
					<Box>
						<Text dimColor>agent-browser: </Text>
						{info.installed ? (
							<Text color="green">installed</Text>
						) : (
							<Text color="red">not installed</Text>
						)}
					</Box>

					<Box>
						<Text dimColor>Session ({sessionName}): </Text>
						{info.sessionStatus === 'running' ? (
							<Text color="green">running</Text>
						) : info.sessionStatus === 'stopped' ? (
							<Text color="yellow">stopped</Text>
						) : (
							<Text color="gray">unknown</Text>
						)}
					</Box>

					<Box>
						<Text dimColor>Profiles: </Text>
						{info.profiles.length > 0 ? (
							<Text>{info.profiles.join(', ')}</Text>
						) : (
							<Text color="gray">none</Text>
						)}
					</Box>
				</Box>

				{!info.installed && (
					<Box marginTop={1}>
						<Text dimColor>Run `corebrain browser install` to install agent-browser</Text>
					</Box>
				)}
			</Box>
		</ThemeContext.Provider>
	);
}
