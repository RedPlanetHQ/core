import { useEffect, useState } from 'react';
import { Text, useApp } from 'ink';
import * as p from '@clack/prompts';
import chalk from 'chalk';
import zod from 'zod';
import { randomUUID } from 'node:crypto';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { getPreferences, updatePreferences } from '@/config/preferences';
import {
	getServiceType,
	getServiceName,
	getServiceStatus,
	stopService,
	uninstallService,
	isServiceInstalled,
	installService,
	startService,
	getServicePid,
} from '@/utils/service-manager/index';
import type { ServiceConfig } from '@/utils/service-manager/index';
import { getConfigPath } from '@/config/paths';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import type { GatewayConfig, GatewaySlots } from '@/types/config';
import { isAgentBrowserInstalled, installAgentBrowser } from '@/utils/agent-browser';

const execAsync = promisify(exec);

export const options = zod.object({
	// Direct set options (non-interactive)
	name: zod.string().optional().describe('Gateway name'),
	description: zod.string().optional().describe('Gateway description'),
	coding: zod.boolean().optional().describe('Enable/disable coding tools'),
	browser: zod.boolean().optional().describe('Enable/disable browser tools'),
	exec: zod.boolean().optional().describe('Enable/disable exec tools'),
	show: zod.boolean().optional().describe('Show current configuration'),
});

type Props = {
	options: zod.infer<typeof options>;
};

// Common exec command patterns
const EXEC_COMMAND_OPTIONS = [
	{ value: 'Bash(git status)', label: 'git status' },
	{ value: 'Bash(git diff *)', label: 'git diff' },
	{ value: 'Bash(git log *)', label: 'git log' },
	{ value: 'Bash(git branch *)', label: 'git branch' },
	{ value: 'Bash(git checkout *)', label: 'git checkout' },
	{ value: 'Bash(git add *)', label: 'git add' },
	{ value: 'Bash(git commit *)', label: 'git commit' },
	{ value: 'Bash(git push *)', label: 'git push' },
	{ value: 'Bash(git pull *)', label: 'git pull' },
	{ value: 'Bash(git fetch *)', label: 'git fetch' },
	{ value: 'Bash(npm run *)', label: 'npm run *' },
	{ value: 'Bash(npm install *)', label: 'npm install' },
	{ value: 'Bash(pnpm run *)', label: 'pnpm run *' },
	{ value: 'Bash(pnpm install *)', label: 'pnpm install' },
	{ value: 'Bash(ls *)', label: 'ls' },
	{ value: 'Bash(cat *)', label: 'cat' },
	{ value: 'Bash(grep *)', label: 'grep' },
	{ value: 'Bash(find *)', label: 'find' },
	{ value: 'Bash(mkdir *)', label: 'mkdir' },
	{ value: 'Bash(rm *)', label: 'rm' },
	{ value: 'Bash(mv *)', label: 'mv' },
	{ value: 'Bash(cp *)', label: 'cp' },
	{ value: 'Bash(curl *)', label: 'curl' },
	{ value: 'Bash(python *)', label: 'python' },
	{ value: 'Bash(node *)', label: 'node' },
];

// Get the path to the gateway-entry.js script
function getGatewayEntryPath(): string {
	const __filename = fileURLToPath(import.meta.url);
	const __dirname = dirname(__filename);
	return join(__dirname, '..', '..', 'server', 'gateway-entry.js');
}

// Check if claude-code is installed
async function isClaudeCodeInstalled(): Promise<{ installed: boolean; path?: string }> {
	try {
		const { stdout } = await execAsync('which claude');
		const path = stdout.trim();
		if (path) {
			return { installed: true, path };
		}
	} catch {
		// Not found
	}
	return { installed: false };
}

// Check if npm is available
async function isNpmAvailable(): Promise<boolean> {
	try {
		await execAsync('which npm');
		return true;
	} catch {
		return false;
	}
}

function formatConfig(config: GatewayConfig | undefined): string {
	if (!config) {
		return chalk.dim('(not configured)');
	}
	return [
		`${chalk.bold('Name:')} ${config.name || chalk.dim('(not set)')}`,
		`${chalk.bold('Description:')} ${config.description || chalk.dim('(none)')}`,
		`${chalk.bold('Coding:')} ${config.slots?.coding?.enabled ? chalk.green('enabled') : chalk.dim('disabled')}`,
		`${chalk.bold('Browser:')} ${config.slots?.browser?.enabled ? chalk.green('enabled') : chalk.dim('disabled')}`,
		`${chalk.bold('Exec:')} ${config.slots?.exec?.enabled ? chalk.green('enabled') : chalk.dim('disabled')}`,
	].join('\n');
}

// Direct update (non-interactive)
async function runDirectUpdate(opts: zod.infer<typeof options>): Promise<{ success: boolean; error?: string }> {
	const prefs = getPreferences();
	const existingConfig = prefs.gateway;

	// Show current config
	if (opts.show) {
		p.note(formatConfig(existingConfig), 'Gateway Configuration');
		return { success: true };
	}

	if (!existingConfig?.id) {
		p.log.error('Gateway not configured. Run `corebrain gateway config` without flags first.');
		return { success: false, error: 'Not configured' };
	}

	const newConfig: GatewayConfig = { ...existingConfig };

	if (opts.name !== undefined) {
		newConfig.name = opts.name;
	}
	if (opts.description !== undefined) {
		newConfig.description = opts.description;
	}

	// Update slots
	const slots: GatewaySlots = { ...existingConfig.slots };
	if (opts.coding !== undefined) {
		slots.coding = { ...slots.coding, enabled: opts.coding };
	}
	if (opts.browser !== undefined) {
		slots.browser = { ...slots.browser, enabled: opts.browser };
	}
	if (opts.exec !== undefined) {
		slots.exec = { ...slots.exec, enabled: opts.exec };
	}
	newConfig.slots = slots;

	updatePreferences({ gateway: newConfig });

	p.log.success(chalk.green('Configuration updated'));
	p.note(formatConfig(newConfig), 'Gateway Configuration');

	return { success: true };
}

// Interactive wizard
async function runInteractiveConfig() {
	const prefs = getPreferences();
	const existingConfig = prefs.gateway;

	p.intro(chalk.bgCyan(chalk.black(' Gateway Configuration ')));

	// Stop existing service if running
	const stopSpinner = p.spinner();
	stopSpinner.start('Checking existing gateway...');
	try {
		const serviceType = getServiceType();
		if (serviceType !== 'none') {
			const serviceName = getServiceName();
			const installed = await isServiceInstalled(serviceName);
			if (installed) {
				const status = await getServiceStatus(serviceName);
				if (status === 'running') {
					stopSpinner.message('Stopping existing gateway...');
					await stopService(serviceName);
				}
				await uninstallService(serviceName);
			}
		}
		stopSpinner.stop('Ready to configure');
	} catch {
		stopSpinner.stop('Ready to configure');
	}

	// Step 1: Name
	const name = await p.text({
		message: 'Gateway name',
		placeholder: 'my-macbook',
		initialValue: existingConfig?.name || '',
		validate: (value) => {
			if (value && !value.trim()) return 'Name is required';
		},
	});

	if (p.isCancel(name)) {
		p.cancel('Configuration cancelled');
		return { cancelled: true };
	}

	// Step 2: Description
	const description = await p.text({
		message: 'Description',
		placeholder: 'Browser and coding on my MacBook',
		initialValue: existingConfig?.description || '',
	});

	if (p.isCancel(description)) {
		p.cancel('Configuration cancelled');
		return { cancelled: true };
	}

	// Step 3: Coding slot
	const codingSpinner = p.spinner();
	codingSpinner.start('Checking for claude-code...');
	const claudeResult = await isClaudeCodeInstalled();
	codingSpinner.stop(claudeResult.installed
		? chalk.green(`Found: ${claudeResult.path}`)
		: chalk.yellow('claude-code not found')
	);

	let codingEnabled = false;
	let claudePath: string | undefined;

	if (claudeResult.installed) {
		claudePath = claudeResult.path;
		const enableCoding = await p.confirm({
			message: 'Enable coding tools?',
			initialValue: existingConfig?.slots?.coding?.enabled ?? true,
		});

		if (p.isCancel(enableCoding)) {
			p.cancel('Configuration cancelled');
			return { cancelled: true };
		}

		codingEnabled = enableCoding;
	}

	// Step 4: Browser slot
	const browserSpinner = p.spinner();
	browserSpinner.start('Checking for agent-browser...');
	let browserInstalled = await isAgentBrowserInstalled();
	browserSpinner.stop(browserInstalled
		? chalk.green('agent-browser installed')
		: chalk.yellow('agent-browser not found')
	);

	let browserEnabled = false;

	if (!browserInstalled) {
		const installBrowser = await p.confirm({
			message: 'Install agent-browser? (npm install -g agent-browser)',
			initialValue: false,
		});

		if (p.isCancel(installBrowser)) {
			p.cancel('Configuration cancelled');
			return { cancelled: true };
		}

		if (installBrowser) {
			const npmAvailable = await isNpmAvailable();
			if (!npmAvailable) {
				p.log.warning('npm not available, skipping browser installation');
			} else {
				const installSpinner = p.spinner();
				installSpinner.start('Installing agent-browser...');
				try {
					const result = await installAgentBrowser();
					if (result.code === 0) {
						installSpinner.stop(chalk.green('agent-browser installed'));
						browserInstalled = true;
						browserEnabled = true;
					} else {
						installSpinner.stop(chalk.red('Installation failed'));
					}
				} catch {
					installSpinner.stop(chalk.red('Installation failed'));
				}
			}
		}
	}

	if (browserInstalled && !browserEnabled) {
		const enableBrowser = await p.confirm({
			message: 'Enable browser tools?',
			initialValue: existingConfig?.slots?.browser?.enabled ?? true,
		});

		if (p.isCancel(enableBrowser)) {
			p.cancel('Configuration cancelled');
			return { cancelled: true };
		}

		browserEnabled = enableBrowser;
	}

	// Step 5: Exec slot
	const enableExec = await p.confirm({
		message: 'Enable exec tools? (run shell commands)',
		initialValue: existingConfig?.slots?.exec?.enabled ?? false,
	});

	if (p.isCancel(enableExec)) {
		p.cancel('Configuration cancelled');
		return { cancelled: true };
	}

	let execEnabled = enableExec;
	let execAllow: string[] = [];
	let execDeny: string[] = [];

	if (execEnabled) {
		const selectedCommands = await p.multiselect({
			message: 'Select allowed commands',
			options: EXEC_COMMAND_OPTIONS,
			initialValues: existingConfig?.slots?.exec?.allow || [],
			required: false,
		});

		if (p.isCancel(selectedCommands)) {
			p.cancel('Configuration cancelled');
			return { cancelled: true };
		}

		execAllow = selectedCommands as string[];

		// Ask for denied commands from remaining
		const remainingCommands = EXEC_COMMAND_OPTIONS.filter(
			opt => !execAllow.includes(opt.value)
		);

		if (remainingCommands.length > 0) {
			const deniedCommands = await p.multiselect({
				message: 'Select denied commands (optional)',
				options: remainingCommands,
				initialValues: existingConfig?.slots?.exec?.deny || [],
				required: false,
			});

			if (!p.isCancel(deniedCommands)) {
				execDeny = deniedCommands as string[];
			}
		}
	}

	// Save configuration
	const saveSpinner = p.spinner();
	saveSpinner.start('Saving configuration...');

	const gatewayId = existingConfig?.id || randomUUID();
	const slots: GatewaySlots = {
		coding: { enabled: codingEnabled },
		browser: { enabled: browserEnabled },
		exec: {
			enabled: execEnabled,
			allow: execAllow.length > 0 ? execAllow : undefined,
			deny: execDeny.length > 0 ? execDeny : undefined,
		},
	};

	const newConfig: GatewayConfig = {
		...prefs.gateway,
		id: gatewayId,
		name: name as string,
		description: (description as string) || '',
		port: prefs.gateway?.port || 0,
		pid: prefs.gateway?.pid || 0,
		startedAt: prefs.gateway?.startedAt || 0,
		slots,
	};

	// Save coding config if enabled
	if (codingEnabled && claudePath) {
		const codingConfig = prefs.coding || {};
		if (!codingConfig['claude-code']) {
			codingConfig['claude-code'] = {
				command: claudePath,
				args: ['-p', '--output-format', 'text', '--dangerously-skip-permissions'],
				resumeArgs: ['-p', '--output-format', 'text', '--dangerously-skip-permissions', '--resume', '{sessionId}'],
				sessionArg: '--session',
				sessionMode: 'always',
				sessionIdFields: ['session_id'],
			};
		}
		updatePreferences({ gateway: newConfig, coding: codingConfig });
	} else {
		updatePreferences({ gateway: newConfig });
	}

	saveSpinner.stop(chalk.green('Configuration saved'));

	// Summary
	p.note(formatConfig(newConfig), 'Configuration Summary');

	// Ask to start
	const shouldStart = await p.confirm({
		message: 'Start gateway now?',
		initialValue: true,
	});

	if (p.isCancel(shouldStart) || !shouldStart) {
		p.outro(chalk.dim("Run 'corebrain gateway on' to start"));
		return { success: true, started: false };
	}

	// Start gateway
	const startSpinner = p.spinner();
	startSpinner.start('Starting gateway...');

	const serviceType = getServiceType();
	if (serviceType === 'none') {
		startSpinner.stop(chalk.red('Service management not supported'));
		return { success: true, started: false, error: 'Service management not supported' };
	}

	const serviceName = getServiceName();
	const gatewayEntryPath = getGatewayEntryPath();
	const logDir = join(getConfigPath(), 'logs');

	const serviceConfig: ServiceConfig = {
		name: serviceName,
		displayName: 'CoreBrain Gateway',
		command: process.execPath,
		args: [gatewayEntryPath],
		port: 0,
		workingDirectory: homedir(),
		logPath: join(logDir, 'gateway-stdout.log'),
		errorLogPath: join(logDir, 'gateway-stderr.log'),
	};

	await installService(serviceConfig);
	await startService(serviceName);
	await new Promise((resolve) => setTimeout(resolve, 500));

	const pid = getServicePid(serviceName);
	const currentPrefs = getPreferences();
	updatePreferences({
		gateway: {
			...currentPrefs.gateway,
			pid: pid ?? 0,
			startedAt: Date.now(),
			serviceInstalled: true,
			serviceType,
			serviceName,
		},
	});

	startSpinner.stop(chalk.green('Gateway started'));
	p.outro(chalk.green('Gateway is running!'));

	return { success: true, started: true };
}

async function runConfig(opts: zod.infer<typeof options>) {
	// Check if any direct options are provided
	const hasDirectOptions =
		opts.name !== undefined ||
		opts.description !== undefined ||
		opts.coding !== undefined ||
		opts.browser !== undefined ||
		opts.exec !== undefined ||
		opts.show;

	if (hasDirectOptions) {
		return runDirectUpdate(opts);
	}

	return runInteractiveConfig();
}

export default function GatewayConfigCommand({ options: opts }: Props) {
	const { exit } = useApp();
	const [status, setStatus] = useState<'running' | 'done' | 'error'>('running');
	const [error, setError] = useState('');

	useEffect(() => {
		let mounted = true;

		runConfig(opts)
			.then((result) => {
				if (mounted) {
					if (result.cancelled) {
						setStatus('done');
					} else if (result.success) {
						setStatus('done');
					} else {
						setError(result.error || 'Unknown error');
						setStatus('error');
					}
				}
			})
			.catch((err) => {
				if (mounted) {
					setError(err instanceof Error ? err.message : 'Unknown error');
					setStatus('error');
				}
			});

		return () => {
			mounted = false;
		};
	}, [opts]);

	useEffect(() => {
		if (status === 'done' || status === 'error') {
			const timer = setTimeout(() => exit(), 100);
			return () => clearTimeout(timer);
		}
	}, [status, exit]);

	if (status === 'error') {
		return <Text color="red">Error: {error}</Text>;
	}

	return null;
}
