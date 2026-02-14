import { useEffect } from 'react';
import { useApp } from 'ink';
import * as p from '@clack/prompts';
import chalk from 'chalk';
import zod from 'zod';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { getPreferences, updatePreferences } from '@/config/preferences';
import type { CliBackendConfig } from '@/types/config';

const execAsync = promisify(exec);

export const options = zod.object({});

type Props = {
	options: zod.infer<typeof options>;
};

interface AgentTemplate {
	name: string;
	commands: string[];
	defaultConfig: Omit<CliBackendConfig, 'command'>;
}

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
			const { stdout } = await execAsync(`which ${cmd}`);
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
	return { name: template.name, command: template.commands[0]!, available: false };
}

async function runCodingSetup(): Promise<void> {
	const spinner = p.spinner();
	spinner.start('Detecting available coding agents...');

	const detectionResults: DetectionResult[] = [];

	for (const template of agentTemplates) {
		const result = await detectAgent(template);
		if (result) {
			detectionResults.push(result);
		}
	}

	// Build and save coding config
	const currentPrefs = getPreferences();
	const existingCoding = (currentPrefs.coding || {}) as Record<string, CliBackendConfig>;

	for (const result of detectionResults) {
		if (result.available) {
			const template = agentTemplates.find((t) => t.name === result.name);
			if (template) {
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

	const availableCount = detectionResults.filter((r) => r.available).length;

	if (availableCount === 0) {
		spinner.stop(chalk.yellow('No coding agents found'));
		p.log.warning('Install:\n- claude (Anthropic Claude Code CLI)');
		return;
	}

	spinner.stop(chalk.green(`Found ${availableCount} coding agent(s)`));

	const lines = detectionResults.map((r) =>
		r.available
			? `  ${chalk.green('✓')} ${r.name}: ${r.path}`
			: `  ${chalk.dim('✗')} ${r.name}: not found`
	);

	p.note(lines.join('\n'), 'Detected Agents');
	p.log.info("Configuration saved. Use 'corebrain coding config --agent <name>' to customize.");
}

export default function CodingSetup(_props: Props) {
	const { exit } = useApp();

	useEffect(() => {
		runCodingSetup()
			.catch((err) => {
				p.log.error(`Detection failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
			})
			.finally(() => {
				setTimeout(() => exit(), 100);
			});
	}, [exit]);

	return null;
}
