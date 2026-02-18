import { useEffect } from 'react';
import { useApp } from 'ink';
import * as p from '@clack/prompts';
import chalk from 'chalk';
import zod from 'zod';
import { getPreferences, updatePreferences } from '@/config/preferences';
import type { ExecConfig } from '@/types/config';

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

function formatConfig(cfg: ExecConfig): string {
	const lines = [
		`${chalk.bold('allow:')} ${cfg.allow?.length ? cfg.allow.join(', ') : chalk.dim('(any - no restrictions)')}`,
		`${chalk.bold('deny:')} ${cfg.deny?.length ? cfg.deny.join(', ') : chalk.dim('(none)')}`,
		`${chalk.bold('defaultDir:')} ${cfg.defaultDir || '~/.corebrain'}`,
	];
	return lines.join('\n');
}

async function runExecConfig(opts: zod.infer<typeof options>): Promise<void> {
	const prefs = getPreferences();
	const existingConfig = prefs.exec || {};

	// Clear config
	if (opts.clear) {
		updatePreferences({ exec: undefined });
		p.log.success(chalk.green('Exec configuration cleared'));
		return;
	}

	// Check if any config options were provided
	const hasConfigOptions =
		opts.allow !== undefined ||
		opts.deny !== undefined ||
		opts.defaultDir !== undefined;

	// If just showing config (no options provided or --show)
	if (opts.show || !hasConfigOptions) {
		p.note(
			[
				formatConfig(existingConfig),
				'',
				chalk.dim('Pattern format: Bash(command pattern *)'),
				chalk.dim('Examples:'),
				chalk.dim('  Bash(npm run *)      - Allow npm run commands'),
				chalk.dim('  Bash(git commit *)   - Allow git commit'),
				chalk.dim('  Bash(* --version)    - Allow version checks'),
				chalk.dim('  Bash(rm -rf *)       - Deny recursive deletes'),
			].join('\n'),
			'Exec Configuration'
		);
		return;
	}

	// Build new config
	const newConfig: ExecConfig = { ...existingConfig };

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
	updatePreferences({ exec: newConfig });

	p.log.success(chalk.green('Updated exec configuration'));
	p.note(formatConfig(newConfig), 'New Configuration');
}

export default function ExecConfigCommand({ options: opts }: Props) {
	const { exit } = useApp();

	useEffect(() => {
		runExecConfig(opts)
			.catch((err) => {
				p.log.error(`Config error: ${err instanceof Error ? err.message : 'Unknown error'}`);
			})
			.finally(() => {
				setTimeout(() => exit(), 100);
			});
	}, [opts, exit]);

	return null;
}
