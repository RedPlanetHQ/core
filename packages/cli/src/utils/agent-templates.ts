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
		// codex 0.118+ split root-level vs `exec`-only flags: `--color` and
		// `--skip-git-repo-check` are now exec-only, so passing them at the
		// root makes codex error and exit. The interactive Code tab uses the
		// root command (no subcommand on new, `resume` on resume).
		defaultConfig: {
			args: [],
			resumeArgs: ['resume', '{sessionId}'],
			sessionMode: 'existing',
			modelArg: '--model',
			imageArg: '--image',
		},
	},
	{
		name: 'opencode',
		commands: ['opencode'],
		// opencode run [message..] is the non-interactive form; the bare `opencode`
		// command opens the TUI and does not accept a positional prompt.
		// --dangerously-skip-permissions bypasses first-run permission dialogs so the
		// headless gateway flow doesn't stall waiting for user interaction.
		// sessionMode:'existing' means opencode assigns its own session ID which we
		// discover from its SQLite database after spawn via findLatestOpenCodeSession.
		defaultConfig: {
			args: ['run', '--dangerously-skip-permissions'],
			resumeArgs: [
				'run',
				'--dangerously-skip-permissions',
				'--session',
				'{sessionId}',
			],
			sessionMode: 'existing',
			modelArg: '--model',
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
