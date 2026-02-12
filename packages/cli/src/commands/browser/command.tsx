import { useEffect, useState } from 'react';
import { Text, Box } from 'ink';
import zod from 'zod';
import { ThemeContext } from '@/hooks/useTheme';
import { themeContextValue } from '@/config/themes';
import ErrorMessage from '@/components/error-message';
import { isAgentBrowserInstalled, runAgentBrowserCommand, type CommandResult } from '@/utils/agent-browser';

export const args = zod.array(zod.string()).describe('Arguments to pass to agent-browser');

export const options = zod.object({});

type Props = {
	args: zod.infer<typeof args>;
	options: zod.infer<typeof options>;
};

export default function BrowserCommand({ args: commandArgs }: Props) {
	const [status, setStatus] = useState<'checking' | 'running' | 'done' | 'not-installed' | 'error'>('checking');
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

				if (!cancelled) {
					setStatus('running');
				}

				const cmdResult = await runAgentBrowserCommand(commandArgs);

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
	}, [commandArgs]);

	return (
		<ThemeContext.Provider value={themeContextValue}>
			{status === 'checking' ? (
				<Text dimColor>Checking agent-browser...</Text>
			) : status === 'not-installed' ? (
				<ErrorMessage message="agent-browser is not installed. Run `corebrain browser install` first." />
			) : status === 'running' ? (
				<Text dimColor>Running: agent-browser {commandArgs.join(' ')}</Text>
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
