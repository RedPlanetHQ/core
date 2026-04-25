import {execFileSync} from 'node:child_process';
import {existsSync} from 'node:fs';
import type {CliBackendConfig} from '@/types/config';

export interface AgentTemplate {
	name: string;
	commands: string[];
	defaultConfig: Omit<CliBackendConfig, 'command'>;
}

/**
 * Default `CliBackendConfig`s for the coding agents we ship support for.
 * Used by `corebrain coding setup` (interactive) AND the env-driven boot
 * path (Docker / headless installs) so the same args ship everywhere.
 */
export const AGENT_TEMPLATES: AgentTemplate[] = [
	{
		name: 'claude-code',
		commands: ['claude'],
		defaultConfig: {
			args: ['--dangerously-skip-permissions'],
			resumeArgs: ['--dangerously-skip-permissions', '--resume', '{sessionId}'],
			sessionArg: '--session-id',
			sessionMode: 'always',
			sessionIdFields: ['session_id'],
		},
	},
	{
		name: 'codex-cli',
		commands: ['codex'],
		defaultConfig: {
			args: ['--color', 'never', '--sandbox', 'read-only', '--skip-git-repo-check'],
			resumeArgs: [
				'resume',
				'{sessionId}',
				'--color',
				'never',
				'--sandbox',
				'read-only',
				'--skip-git-repo-check',
			],
			sessionMode: 'existing',
			modelArg: '--model',
			imageArg: '--image',
		},
	},
];

/**
 * Resolve a bare command via `command -v`. Returns the absolute path if the
 * binary exists on PATH, null otherwise. Lightweight enough to call at boot.
 */
export function resolveCommand(cmd: string): string | null {
	if (cmd.includes('/')) return existsSync(cmd) ? cmd : null;
	try {
		const out = execFileSync('/bin/sh', ['-c', `command -v ${cmd}`], {
			encoding: 'utf8',
			timeout: 2_000,
		});
		const path = out.trim();
		return path || null;
	} catch {
		return null;
	}
}
