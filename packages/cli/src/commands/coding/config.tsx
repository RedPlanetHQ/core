import {useEffect, useState} from 'react';
import {Text} from 'ink';
import zod from 'zod';
import {getPreferences, updatePreferences} from '@/config/preferences';
import SuccessMessage from '@/components/success-message';
import ErrorMessage from '@/components/error-message';
import InfoMessage from '@/components/info-message';
import {ThemeContext} from '@/hooks/useTheme';
import {themeContextValue} from '@/config/themes';
import type {CliBackendConfig} from '@/types/config';

export const options = zod.object({
	agent: zod.string().describe('Agent name (e.g., claude-code)'),
	command: zod.string().optional().describe('CLI command path'),
	args: zod.string().optional().describe('Default args (comma-separated)'),
	resumeArgs: zod.string().optional().describe('Resume args (comma-separated, use {sessionId} placeholder)'),
	sessionArg: zod.string().optional().describe('Session argument flag (e.g., --session)'),
	sessionMode: zod.enum(['new', 'existing', 'always']).optional().describe('Session mode'),
	allowedTools: zod.string().optional().describe('Comma-separated list of allowed tools'),
	disallowedTools: zod.string().optional().describe('Comma-separated list of disallowed tools'),
	modelArg: zod.string().optional().describe('Model argument flag'),
	show: zod.boolean().optional().describe('Show current config'),
});

type Props = {
	options: zod.infer<typeof options>;
};

export default function CodingAgentConfig({options: opts}: Props) {
	const [status, setStatus] = useState<'loading' | 'updated' | 'show' | 'not-found' | 'error'>(
		'loading',
	);
	const [config, setConfig] = useState<CliBackendConfig | null>(null);
	const [error, setError] = useState('');

	const agentName = opts.agent;

	useEffect(() => {
		try {
			const prefs = getPreferences();
			const coding = (prefs.coding || {}) as Record<string, CliBackendConfig>;
			const existingConfig = coding[agentName];

			// Check if any config options were provided
			const hasConfigOptions =
				opts.command !== undefined ||
				opts.args !== undefined ||
				opts.resumeArgs !== undefined ||
				opts.sessionArg !== undefined ||
				opts.sessionMode !== undefined ||
				opts.allowedTools !== undefined ||
				opts.disallowedTools !== undefined ||
				opts.modelArg !== undefined;

			// If just showing config (no options provided or --show)
			if (opts.show || !hasConfigOptions) {
				if (!existingConfig) {
					setStatus('not-found');
					return;
				}
				setConfig(existingConfig);
				setStatus('show');
				return;
			}

			// Build new config
			const newConfig: CliBackendConfig = existingConfig || {command: agentName};

			if (opts.command !== undefined) {
				newConfig.command = opts.command;
			}
			if (opts.args !== undefined) {
				newConfig.args = opts.args
					.split(',')
					.map((a) => a.trim())
					.filter(Boolean);
			}
			if (opts.resumeArgs !== undefined) {
				newConfig.resumeArgs = opts.resumeArgs
					.split(',')
					.map((a) => a.trim())
					.filter(Boolean);
			}
			if (opts.sessionArg !== undefined) {
				newConfig.sessionArg = opts.sessionArg;
			}
			if (opts.sessionMode !== undefined) {
				newConfig.sessionMode = opts.sessionMode;
			}
			if (opts.allowedTools !== undefined) {
				newConfig.allowedTools = opts.allowedTools
					.split(',')
					.map((t) => t.trim())
					.filter(Boolean);
			}
			if (opts.disallowedTools !== undefined) {
				newConfig.disallowedTools = opts.disallowedTools
					.split(',')
					.map((t) => t.trim())
					.filter(Boolean);
			}
			if (opts.modelArg !== undefined) {
				newConfig.modelArg = opts.modelArg;
			}

			// Save config
			coding[agentName] = newConfig;
			updatePreferences({coding});

			setConfig(newConfig);
			setStatus('updated');
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Unknown error');
			setStatus('error');
		}
	}, [agentName, opts]);

	const formatConfig = (cfg: CliBackendConfig) => {
		const lines = [
			`command: ${cfg.command}`,
			`args: ${cfg.args?.join(' ') || '(none)'}`,
			`resumeArgs: ${cfg.resumeArgs?.join(' ') || '(none)'}`,
			`sessionArg: ${cfg.sessionArg || '(not set)'}`,
			`sessionMode: ${cfg.sessionMode || '(not set)'}`,
			`allowedTools: ${cfg.allowedTools?.join(', ') || '(none)'}`,
			`disallowedTools: ${cfg.disallowedTools?.join(', ') || '(none)'}`,
			`modelArg: ${cfg.modelArg || '(not set)'}`,
		];
		return lines.join('\n');
	};

	return (
		<ThemeContext.Provider value={themeContextValue}>
			{status === 'loading' ? (
				<Text dimColor>Loading configuration...</Text>
			) : status === 'error' ? (
				<ErrorMessage message={`Config error: ${error}`} />
			) : status === 'not-found' ? (
				<ErrorMessage
					message={`Agent "${agentName}" not configured.\n\nRun 'corebrain coding setup' to auto-detect\nor configure with:\n  corebrain coding config --agent ${agentName} --command /path/to/cli`}
					hideTitle
				/>
			) : status === 'show' && config ? (
				<InfoMessage message={`${agentName} Configuration\n\n${formatConfig(config)}`} />
			) : status === 'updated' && config ? (
				<SuccessMessage message={`Updated ${agentName} configuration\n\n${formatConfig(config)}`} />
			) : null}
		</ThemeContext.Provider>
	);
}
