import { useEffect, useState } from 'react';
import { Text } from 'ink';
import zod from 'zod';
import { getPreferences, updatePreferences } from '@/config/preferences';
import { spawnDetached, isPidRunning } from '@/utils/process';
import { isTmuxAvailable } from '@/utils/tmux';
import SuccessMessage from '@/components/success-message';
import ErrorMessage from '@/components/error-message';
import { ThemeContext } from '@/hooks/useTheme';
import { themeContextValue } from '@/config/themes';
import { join } from 'node:path';

const DEFAULT_PORT = 3456;

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
				// Check if tmux is available (needed for session management)
				const tmuxAvailable = await isTmuxAvailable();
				if (!tmuxAvailable) {
					if (!cancelled) {
						setError('tmux is not installed. Please install tmux first (required for session management).');
						setStatus('error');
					}
					return;
				}

				// Check if gateway is already running
				const prefs = getPreferences();
				if (prefs.gateway?.pid) {
					const running = isPidRunning(prefs.gateway.pid);
					if (running) {
						if (!cancelled) {
							setPort(prefs.gateway.port);
							setStatus('already-running');
						}
						return;
					}
				}

				// Start the gateway server
				setStatus('starting');

				// Path to the corebrain CLI
				const cliPath = join(process.cwd(), 'packages', 'cli', 'dist', 'cli.js');

				// Spawn detached process running `corebrain server`
				const pid = spawnDetached('node', [cliPath, 'server', '--port', String(port)], {
					cwd: process.cwd(),
				});

				// Wait a bit for the server to start
				await new Promise((resolve) => setTimeout(resolve, 1500));

				// Verify it's still running
				if (!isPidRunning(pid)) {
					if (!cancelled) {
						setError('Gateway process started but exited immediately. Check logs in ~/.corebrain/logs/');
						setStatus('error');
					}
					return;
				}

				// Save gateway info to preferences
				updatePreferences({
					gateway: {
						port,
						pid,
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
					message={`Gateway server started successfully on port ${port}\n\nAPI Endpoints:\n  POST   http://localhost:${port}/sessions\n  GET    http://localhost:${port}/sessions\n  GET    http://localhost:${port}/sessions/:id\n  DELETE http://localhost:${port}/sessions/:id`}
				/>
			) : status === 'error' ? (
				<ErrorMessage message={`Failed to start gateway: ${error}`} />
			) : null}
		</ThemeContext.Provider>
	);
}
