import { useEffect, useState } from 'react';
import { Text, Box } from 'ink';
import zod from 'zod';
import { ThemeContext } from '@/hooks/useTheme';
import { themeContextValue } from '@/config/themes';
import ErrorMessage from '@/components/error-message';
import { isAgentBrowserInstalled, browserCommand, getSession, isBlockedCommand, type CommandResult } from '@/utils/agent-browser';

export const args = zod.tuple([
	zod.string().describe('Session name'),
	zod.string().describe('Command to run'),
]).rest(zod.string().describe('Command arguments'));

export const options = zod.object({});

type Props = {
	args: zod.infer<typeof args>;
	options: zod.infer<typeof options>;
};

export default function BrowserCommand({ args: [sessionName, command, ...commandArgs] }: Props) {
	const [status, setStatus] = useState<'checking' | 'running' | 'done' | 'not-installed' | 'not-found' | 'blocked' | 'error'>('checking');
	const [result, setResult] = useState<CommandResult | null>(null);
	const [error, setError] = useState('');

	useEffect(() => {
		let cancelled = false;

		(async () => {
			try {
				const installed = await isAgentBrowserInstalled();

				if (!installed) {
					if (!cancelled) {
						setStatus('not-installed');
					}
					return;
				}

				// Check if command is blocked
				if (isBlockedCommand(command)) {
					if (!cancelled) {
						setError(`Command "${command}" is blocked. Use \`corebrain browser open\` or \`corebrain browser close\` for open/close operations.`);
						setStatus('blocked');
					}
					return;
				}

				// Check if session exists
				const session = getSession(sessionName);
				if (!session) {
					if (!cancelled) {
						setStatus('not-found');
					}
					return;
				}

				if (!cancelled) {
					setStatus('running');
				}

				const cmdResult = await browserCommand(sessionName, command, commandArgs);

				if (!cancelled) {
					setResult(cmdResult);
					setStatus('done');
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
	}, [sessionName, command, commandArgs]);

	return (
		<ThemeContext.Provider value={themeContextValue}>
			{status === 'checking' ? (
				<Text dimColor>Checking agent-browser...</Text>
			) : status === 'not-installed' ? (
				<ErrorMessage message="agent-browser is not installed. Run `corebrain browser install` first." />
			) : status === 'not-found' ? (
				<ErrorMessage message={`Session "${sessionName}" not found. Use \`corebrain browser open\` to create a session first.`} />
			) : status === 'blocked' ? (
				<ErrorMessage message={error} />
			) : status === 'running' ? (
				<Text dimColor>Running: {command} {commandArgs.join(' ')} on session "{sessionName}"</Text>
			) : status === 'done' && result ? (
				<Box flexDirection="column">
					{result.stdout && <Text>{result.stdout}</Text>}
					{result.stderr && <Text color="red">{result.stderr}</Text>}
					{result.code !== 0 && <Text dimColor>Exit code: {result.code}</Text>}
				</Box>
			) : status === 'error' ? (
				<ErrorMessage message={error} />
			) : null}
		</ThemeContext.Provider>
	);
}
