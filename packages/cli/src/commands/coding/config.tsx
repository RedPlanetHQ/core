import { useEffect } from 'react';
import { useApp } from 'ink';
import * as p from '@clack/prompts';
import chalk from 'chalk';
import zod from 'zod';
import { getPreferences, updatePreferences } from '@/config/preferences';
import type { CliBackendConfig } from '@/types/config';

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

function formatConfig(cfg: CliBackendConfig): string {
	const lines = [
		`${chalk.bold('command:')} ${cfg.command}`,
		`${chalk.bold('args:')} ${cfg.args?.join(' ') || chalk.dim('(none)')}`,
		`${chalk.bold('resumeArgs:')} ${cfg.resumeArgs?.join(' ') || chalk.dim('(none)')}`,
		`${chalk.bold('sessionArg:')} ${cfg.sessionArg || chalk.dim('(not set)')}`,
		`${chalk.bold('sessionMode:')} ${cfg.sessionMode || chalk.dim('(not set)')}`,
		`${chalk.bold('allowedTools:')} ${cfg.allowedTools?.join(', ') || chalk.dim('(none)')}`,
		`${chalk.bold('disallowedTools:')} ${cfg.disallowedTools?.join(', ') || chalk.dim('(none)')}`,
		`${chalk.bold('modelArg:')} ${cfg.modelArg || chalk.dim('(not set)')}`,
	];
	return lines.join('\n');
}

async function runCodingConfig(opts: zod.infer<typeof options>): Promise<void> {
	const agentName = opts.agent;
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
			p.log.warning(`Agent "${agentName}" not configured.`);
			p.log.info(`Run 'corebrain coding setup' to auto-detect\nor configure with:\n  corebrain coding config --agent ${agentName} --command /path/to/cli`);
			return;
		}
		p.note(formatConfig(existingConfig), `${agentName} Configuration`);
		return;
	}

	// Build new config
	const newConfig: CliBackendConfig = existingConfig || { command: agentName };

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
	updatePreferences({ coding });

	p.log.success(chalk.green(`Updated ${agentName} configuration`));
	p.note(formatConfig(newConfig), 'New Configuration');
}

export default function CodingAgentConfig({ options: opts }: Props) {
	const { exit } = useApp();

	useEffect(() => {
		runCodingConfig(opts)
			.catch((err) => {
				p.log.error(`Config error: ${err instanceof Error ? err.message : 'Unknown error'}`);
			})
			.finally(() => {
				setTimeout(() => exit(), 100);
			});
	}, [opts, exit]);

	return null;
}
