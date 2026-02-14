import {useEffect, useState} from 'react';
import {Text} from 'ink';
import zod from 'zod';
import {getPreferences, updatePreferences} from '@/config/preferences';
import SuccessMessage from '@/components/success-message';
import ErrorMessage from '@/components/error-message';
import InfoMessage from '@/components/info-message';
import {ThemeContext} from '@/hooks/useTheme';
import {themeContextValue} from '@/config/themes';
import type {ExecConfig} from '@/types/config';

export const options = zod.object({
	allow: zod.string().optional().describe('Allow patterns (comma-separated, e.g., "Bash(npm run *),Bash(git status)")'),
	deny: zod.string().optional().describe('Deny patterns (comma-separated, e.g., "Bash(rm -rf *),Bash(git push *)")'),
	defaultDir: zod.string().optional().describe('Default working directory for commands'),
	clear: zod.boolean().optional().describe('Clear all exec configuration'),
	show: zod.boolean().optional().describe('Show current config'),
});

type Props = {
	options: zod.infer<typeof options>;
};

export default function ExecConfigCommand({options: opts}: Props) {
	const [status, setStatus] = useState<'loading' | 'updated' | 'show' | 'cleared' | 'error'>(
		'loading',
	);
	const [config, setConfig] = useState<ExecConfig | null>(null);
	const [error, setError] = useState('');

	useEffect(() => {
		try {
			const prefs = getPreferences();
			const existingConfig = prefs.exec || {};

			// Clear config
			if (opts.clear) {
				updatePreferences({exec: undefined});
				setStatus('cleared');
				return;
			}

			// Check if any config options were provided
			const hasConfigOptions =
				opts.allow !== undefined ||
				opts.deny !== undefined ||
				opts.defaultDir !== undefined;

			// If just showing config (no options provided or --show)
			if (opts.show || !hasConfigOptions) {
				setConfig(existingConfig);
				setStatus('show');
				return;
			}

			// Build new config
			const newConfig: ExecConfig = {...existingConfig};

			if (opts.allow !== undefined) {
				newConfig.allow = opts.allow
					.split(',')
					.map((p) => p.trim())
					.filter(Boolean);
			}
			if (opts.deny !== undefined) {
				newConfig.deny = opts.deny
					.split(',')
					.map((p) => p.trim())
					.filter(Boolean);
			}
			if (opts.defaultDir !== undefined) {
				newConfig.defaultDir = opts.defaultDir;
			}

			// Save config
			updatePreferences({exec: newConfig});

			setConfig(newConfig);
			setStatus('updated');
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Unknown error');
			setStatus('error');
		}
	}, [opts]);

	const formatConfig = (cfg: ExecConfig) => {
		const lines = [
			`allow: ${cfg.allow?.length ? cfg.allow.join(', ') : '(any - no restrictions)'}`,
			`deny: ${cfg.deny?.length ? cfg.deny.join(', ') : '(none)'}`,
			`defaultDir: ${cfg.defaultDir || '~/.corebrain'}`,
		];
		return lines.join('\n');
	};

	return (
		<ThemeContext.Provider value={themeContextValue}>
			{status === 'loading' ? (
				<Text dimColor>Loading configuration...</Text>
			) : status === 'error' ? (
				<ErrorMessage message={`Config error: ${error}`} />
			) : status === 'cleared' ? (
				<SuccessMessage message="Exec configuration cleared" />
			) : status === 'show' && config ? (
				<InfoMessage
					message={`Exec Configuration\n\n${formatConfig(config)}\n\nPattern format: Bash(command pattern *)\nExamples:\n  Bash(npm run *)      - Allow npm run commands\n  Bash(git commit *)   - Allow git commit\n  Bash(* --version)    - Allow version checks\n  Bash(rm -rf *)       - Deny recursive deletes`}
				/>
			) : status === 'updated' && config ? (
				<SuccessMessage message={`Updated exec configuration\n\n${formatConfig(config)}`} />
			) : null}
		</ThemeContext.Provider>
	);
}
