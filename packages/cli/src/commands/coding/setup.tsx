import {useEffect, useState} from 'react';
import {Text} from 'ink';
import zod from 'zod';
import {exec} from 'node:child_process';
import {promisify} from 'node:util';
import {getPreferences, updatePreferences} from '@/config/preferences';
import SuccessMessage from '@/components/success-message';
import ErrorMessage from '@/components/error-message';
import {ThemeContext} from '@/hooks/useTheme';
import {themeContextValue} from '@/config/themes';
import type {CliBackendConfig} from '@/types/config';

const execAsync = promisify(exec);

export const options = zod.object({});

type Props = {
	options: zod.infer<typeof options>;
};

interface AgentTemplate {
	name: string;
	commands: string[]; // Possible command names to look for
	defaultConfig: Omit<CliBackendConfig, 'command'>;
}

// Default configurations for known agents
const agentTemplates: AgentTemplate[] = [
	{
		name: 'claude-code',
		commands: ['claude'],
		defaultConfig: {
			args: ['-p', '--output-format', 'text', '--dangerously-skip-permissions'],
			resumeArgs: ['-p', '--output-format', 'text', '--dangerously-skip-permissions', '--resume', '{sessionId}'],
			sessionArg: '--session',
			sessionMode: 'always',
			sessionIdFields: ['session_id'],
		},
	},
	{
		name: 'codex',
		commands: ['codex'],
		defaultConfig: {
			args: [],
			resumeArgs: [],
		},
	},
];

interface DetectionResult {
	name: string;
	command: string;
	available: boolean;
	path?: string;
}

async function detectAgent(template: AgentTemplate): Promise<DetectionResult | null> {
	for (const cmd of template.commands) {
		try {
			const {stdout} = await execAsync(`which ${cmd}`);
			const path = stdout.trim();
			if (path) {
				return {
					name: template.name,
					command: cmd,
					available: true,
					path,
				};
			}
		} catch {
			// Command not found, try next
		}
	}
	return {name: template.name, command: template.commands[0]!, available: false};
}

export default function CodingSetup(_props: Props) {
	const [status, setStatus] = useState<'detecting' | 'done' | 'error'>('detecting');
	const [results, setResults] = useState<DetectionResult[]>([]);
	const [error, setError] = useState('');

	useEffect(() => {
		let cancelled = false;

		(async () => {
			try {
				const detectionResults: DetectionResult[] = [];

				for (const template of agentTemplates) {
					const result = await detectAgent(template);
					if (result) {
						detectionResults.push(result);
					}
				}

				if (cancelled) return;

				setResults(detectionResults);

				// Build and save coding config
				const currentPrefs = getPreferences();
				const existingCoding = (currentPrefs.coding || {}) as Record<string, CliBackendConfig>;

				for (const result of detectionResults) {
					if (result.available) {
						const template = agentTemplates.find((t) => t.name === result.name);
						if (template) {
							// Only add if not already configured
							if (!existingCoding[result.name]) {
								existingCoding[result.name] = {
									command: result.path || result.command,
									...template.defaultConfig,
								};
							}
						}
					}
				}

				updatePreferences({
					coding: existingCoding,
				});

				setStatus('done');
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

	const availableCount = results.filter((r) => r.available).length;

	return (
		<ThemeContext.Provider value={themeContextValue}>
			{status === 'detecting' ? (
				<Text dimColor>Detecting available coding agents...</Text>
			) : status === 'error' ? (
				<ErrorMessage message={`Detection failed: ${error}`} />
			) : availableCount === 0 ? (
				<ErrorMessage
					message="No coding agents found.\n\nInstall one of:\n- claude (Anthropic Claude CLI)\n- codex (OpenAI Codex CLI)"
					hideTitle
				/>
			) : (
				<SuccessMessage
					message={`Found ${availableCount} coding agent(s)\n\n${results
						.map((r) =>
							r.available
								? `  ${r.name}: ${r.path}`
								: `  ${r.name}: not found`,
						)
						.join('\n')}\n\nConfiguration saved. Use 'corebrain coding <agent> config' to customize.`}
				/>
			)}
		</ThemeContext.Provider>
	);
}
