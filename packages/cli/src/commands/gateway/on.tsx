import React, { useEffect, useState } from 'react';
import { Text } from 'ink';
import zod from 'zod';
import { getPreferences, updatePreferences } from '@/config/preferences';
import {
	isTmuxAvailable,
	sessionExists,
	createSession,
	getSessionPid,
} from '@/utils/tmux';
import SuccessMessage from '@/components/success-message';
import ErrorMessage from '@/components/error-message';
import { ThemeContext } from '@/hooks/useTheme';
import { themeContextValue } from '@/config/themes';

const DEFAULT_PORT = 3456;
const GATEWAY_SESSION_NAME = 'corebrain-gateway';

export const options = zod.object({
	port: zod.number().optional().describe('Port for the gateway server'),
});

type Props = {
	options: zod.infer<typeof options>;
};

export default function GatewayOn({ options }: Props) {
	const [status, setStatus] = useState<
		| 'checking'
		| 'starting'
		| 'success'
		| 'already-running'
		| 'error'
	>('checking');
	const [error, setError] = useState('');
	const [port, setPort] = useState(options.port || DEFAULT_PORT);

	useEffect(() => {
		let cancelled = false;

		(async () => {
			try {
				// Check if tmux is available
				const tmuxAvailable = await isTmuxAvailable();
				if (!tmuxAvailable) {
					if (!cancelled) {
						setError('tmux is not installed. Please install tmux first.');
						setStatus('error');
					}
					return;
				}

				// Check if gateway is already running
				const prefs = getPreferences();
				if (prefs.gateway) {
					const exists = await sessionExists(prefs.gateway.sessionName);
					if (exists) {
						if (!cancelled) {
							setPort(prefs.gateway.port);
							setStatus('already-running');
						}
						return;
					}
				}

				// Start the gateway server
				setStatus('starting');

				const serverCode = `
const { startGatewayServer } = require('${process.cwd()}/packages/cli/dist/server/gateway.js');
startGatewayServer(${port}).then(({ port }) => {
  console.log('Gateway server started on port', port);
}).catch(err => {
  console.error('Failed to start gateway:', err);
  process.exit(1);
});
`;

				// Create tmux session with the server
				await createSession(
					GATEWAY_SESSION_NAME,
					`node -e "${serverCode.replace(/\n/g, ' ').replace(/"/g, '\\"')}"`,
				);

				// Wait a bit for the server to start
				await new Promise((resolve) => setTimeout(resolve, 1000));

				// Get the PID
				const pid = await getSessionPid(GATEWAY_SESSION_NAME);

				// Save gateway info to preferences
				updatePreferences({
					gateway: {
						sessionName: GATEWAY_SESSION_NAME,
						port,
						pid: pid || undefined,
						startedAt: Date.now(),
					},
				});

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
			) : status === 'starting' ? (
				<Text dimColor>Starting gateway server...</Text>
			) : status === 'already-running' ? (
				<SuccessMessage
					message={`Gateway is already running on port ${port}`}
					hideTitle
				/>
			) : status === 'success' ? (
				<SuccessMessage
					message={`Gateway server started successfully on port ${port}\n\nSession: ${GATEWAY_SESSION_NAME}\n\nAPI Endpoints:\n  POST   http://localhost:${port}/sessions\n  GET    http://localhost:${port}/sessions\n  GET    http://localhost:${port}/sessions/:id\n  DELETE http://localhost:${port}/sessions/:id`}
				/>
			) : status === 'error' ? (
				<ErrorMessage message={`Failed to start gateway: ${error}`} />
			) : null}
		</ThemeContext.Provider>
	);
}
