import {useEffect, useState} from 'react';
import {Text, useApp} from 'ink';
import * as p from '@clack/prompts';
import chalk from 'chalk';
import zod from 'zod';
import {randomUUID} from 'node:crypto';
import {exec} from 'node:child_process';
import {promisify} from 'node:util';
import {existsSync, realpathSync, statSync} from 'node:fs';
import {getPreferences, updatePreferences} from '@/config/preferences';
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
import type {ServiceConfig} from '@/utils/service-manager/index';
import {getConfigPath} from '@/config/paths';
import {join, dirname, resolve, isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import {homedir} from 'node:os';
import type {GatewayConfig, GatewaySlots, StoredFolder} from '@/types/config';
import {
	isPlaywrightReady,
	installPlaywrightChromium,
} from '@/utils/browser-config';
import {runRegister} from './register';

const execAsync = promisify(exec);

// Tool slot definitions
type ToolSlot = 'browser' | 'coding' | 'exec' | 'files';

function expandHome(input: string): string {
	const trimmed = input.trim();
	if (trimmed === '~') return homedir();
	if (trimmed.startsWith('~/')) return join(homedir(), trimmed.slice(2));
	return trimmed;
}

interface ToolSlotInfo {
	value: ToolSlot;
	label: string;
	hint: string;
	checkAvailable?: () => Promise<{
		available: boolean;
		message?: string;
		path?: string;
	}>;
	configure?: (
		existingConfig: GatewayConfig | undefined,
	) => Promise<{enabled: boolean; config?: Record<string, unknown>} | symbol>;
}

export const options = zod.object({
	// Direct set options (non-interactive)
	name: zod.string().optional().describe('Gateway name'),
	description: zod.string().optional().describe('Gateway description'),
	coding: zod.boolean().optional().describe('Enable/disable coding tools'),
	browser: zod.boolean().optional().describe('Enable/disable browser tools'),
	exec: zod.boolean().optional().describe('Enable/disable exec tools'),
	files: zod.boolean().optional().describe('Enable/disable files tools (read/write/edit/glob/grep)'),
	show: zod.boolean().optional().describe('Show current configuration'),
});

type Props = {
	options: zod.infer<typeof options>;
};

// Common exec command patterns - simplified groups
const EXEC_COMMAND_OPTIONS = [
	{value: 'Bash(git *)', label: 'git *', hint: 'All git commands'},
	{value: 'Bash(npm *)', label: 'npm *', hint: 'All npm commands'},
	{value: 'Bash(pnpm *)', label: 'pnpm *', hint: 'All pnpm commands'},
	{value: 'Bash(yarn *)', label: 'yarn *', hint: 'All yarn commands'},
	{value: 'Bash(ls *)', label: 'ls *', hint: 'List files'},
	{value: 'Bash(cat *)', label: 'cat *', hint: 'Read files'},
	{value: 'Bash(grep *)', label: 'grep *', hint: 'Search in files'},
	{value: 'Bash(find *)', label: 'find *', hint: 'Find files'},
	{value: 'Bash(mkdir *)', label: 'mkdir *', hint: 'Create directories'},
	{value: 'Bash(rm *)', label: 'rm *', hint: 'Remove files'},
	{value: 'Bash(mv *)', label: 'mv *', hint: 'Move files'},
	{value: 'Bash(cp *)', label: 'cp *', hint: 'Copy files'},
	{value: 'Bash(curl *)', label: 'curl *', hint: 'HTTP requests'},
	{value: 'Bash(python *)', label: 'python *', hint: 'Run Python'},
	{value: 'Bash(node *)', label: 'node *', hint: 'Run Node.js'},
];

// Special options for allow/deny mode
const EXEC_MODE_OPTIONS = [
	{value: 'allow_all', label: 'Allow all commands'},
	{value: 'deny_all', label: 'Deny all commands'},
	{value: 'custom', label: 'Select specific commands'},
];

// Get the path to the gateway-entry.js script
function getGatewayEntryPath(): string {
	const __filename = fileURLToPath(import.meta.url);
	const __dirname = dirname(__filename);
	return join(__dirname, '..', '..', 'server', 'gateway-entry.js');
}

// Check if claude-code is installed
async function isClaudeCodeInstalled(): Promise<{
	installed: boolean;
	path?: string;
}> {
	try {
		const {stdout} = await execAsync('which claude');
		const path = stdout.trim();
		if (path) {
			return {installed: true, path};
		}
	} catch {
		// Not found
	}
	return {installed: false};
}

function formatConfig(config: GatewayConfig | undefined): string {
	if (!config) {
		return chalk.dim('(not configured)');
	}
	return [
		`${chalk.bold('Name:')} ${config.name || chalk.dim('(not set)')}`,
		`${chalk.bold('Description:')} ${
			config.description || chalk.dim('(none)')
		}`,
		`${chalk.bold('Base URL:')} ${config.httpBaseUrl || chalk.dim('(not registered — run `corebrain gateway register`)')}`,
		`${chalk.bold('HTTP port:')} ${config.httpPort ?? chalk.dim('(default 7787)')}`,
		`${chalk.bold('Registered:')} ${config.securityKeyHash ? chalk.green('yes') : chalk.yellow('no')}`,
		config.tunnelKind && config.tunnelKind !== 'none'
			? `${chalk.bold('Tunnel:')} ${config.tunnelKind}${config.tunnelPid ? chalk.dim(` (pid ${config.tunnelPid})`) : ''}`
			: `${chalk.bold('Tunnel:')} ${chalk.dim('none')}`,
		`${chalk.bold('Browser:')} ${
			config.slots?.browser?.enabled
				? chalk.green('enabled')
				: chalk.dim('disabled')
		}`,
		`${chalk.bold('Coding:')} ${
			config.slots?.coding?.enabled
				? chalk.green('enabled')
				: chalk.dim('disabled')
		}`,
		`${chalk.bold('Exec:')} ${
			config.slots?.exec?.enabled
				? chalk.green('enabled')
				: chalk.dim('disabled')
		}`,
		`${chalk.bold('Files:')} ${
			config.slots?.files?.enabled
				? chalk.green('enabled')
				: chalk.dim('disabled')
		}`,
		`${chalk.bold('Folders:')} ${
			config.folders && config.folders.length > 0
				? '\n' +
					config.folders
						.map(
							f =>
								`  - ${chalk.cyan(f.name)} ${chalk.dim(f.path)} [${f.scopes.join(', ')}]`,
						)
						.join('\n')
				: chalk.dim('(none)')
		}`,
	].join('\n');
}

async function configureFolders(
	initialFolders: StoredFolder[],
): Promise<StoredFolder[] | symbol> {
	const folders = [...initialFolders];

	if (folders.length > 0) {
		const list = folders
			.map(f => `  - ${chalk.cyan(f.name)} ${chalk.dim(f.path)}`)
			.join('\n');
		p.note(
			`${list}\n\n${chalk.dim('Remove with `corebrain folder remove <name>`.')}`,
			`Registered folders (${folders.length})`,
		);
	}

	// eslint-disable-next-line no-constant-condition
	while (true) {
		const rawPath = await p.text({
			message: 'Add folder path (blank to finish)',
			placeholder: '/Users/you/code/project',
			defaultValue: '',
			validate: value => {
				const v = (value ?? '').trim();
				if (!v) return;
				const expanded = expandHome(v);
				if (!isAbsolute(expanded)) return 'Path must be absolute';
				if (!existsSync(expanded)) return `Path does not exist: ${expanded}`;
				if (!statSync(expanded).isDirectory()) {
					return `Not a directory: ${expanded}`;
				}
				const abs = realpathSync(resolve(expanded));
				if (folders.some(f => f.path === abs)) {
					return 'Folder already registered';
				}
			},
		});
		if (p.isCancel(rawPath)) return rawPath;

		const trimmed = (rawPath as string).trim();
		if (!trimmed) break;

		const abs = realpathSync(resolve(expandHome(trimmed)));
		const baseName = abs.split('/').filter(Boolean).pop() ?? 'folder';
		let name = baseName;
		for (let i = 2; folders.some(f => f.name === name); i++) {
			name = `${baseName}-${i}`;
		}

		folders.push({
			id: `fld_${randomUUID()}`,
			name,
			path: abs,
			scopes: ['files', 'coding', 'exec'],
			gitRepo: existsSync(`${abs}/.git`),
		});

		p.log.success(chalk.green(`Added: ${abs}`));
	}

	return folders;
}

// Direct update (non-interactive)
async function runDirectUpdate(
	opts: zod.infer<typeof options>,
): Promise<{success: boolean; error?: string}> {
	const prefs = getPreferences();
	const existingConfig = prefs.gateway;

	// Show current config
	if (opts.show) {
		p.note(formatConfig(existingConfig), 'Gateway Configuration');
		return {success: true};
	}

	// Generate id if not exists
	const gatewayId = existingConfig?.id || randomUUID();

	const newConfig: GatewayConfig = {
		...existingConfig,
		id: gatewayId,
		pid: existingConfig?.pid || 0,
		startedAt: existingConfig?.startedAt || 0,
	};

	if (opts.name !== undefined) {
		newConfig.name = opts.name;
	}
	if (opts.description !== undefined) {
		newConfig.description = opts.description;
	}

	// Update slots
	const slots: GatewaySlots = {...existingConfig?.slots};
	if (opts.coding !== undefined) {
		slots.coding = {...slots.coding, enabled: opts.coding};
	}
	if (opts.browser !== undefined) {
		slots.browser = {...slots.browser, enabled: opts.browser};
	}
	if (opts.exec !== undefined) {
		slots.exec = {...slots.exec, enabled: opts.exec};
	}
	if (opts.files !== undefined) {
		slots.files = {...slots.files, enabled: opts.files};
	}
	newConfig.slots = slots;

	updatePreferences({gateway: newConfig});

	p.log.success(chalk.green('Configuration updated'));
	p.note(formatConfig(newConfig), 'Gateway Configuration');

	return {success: true};
}

// Configure exec slot
async function configureExec(
	existingConfig: GatewayConfig | undefined,
): Promise<{allow: string[]; deny: string[]} | symbol> {
	const execMode = await p.select({
		message: 'Command access mode',
		options: EXEC_MODE_OPTIONS,
		initialValue: 'custom',
	});

	if (p.isCancel(execMode)) {
		return execMode;
	}

	let execAllow: string[] = [];
	let execDeny: string[] = [];

	if (execMode === 'allow_all') {
		execAllow = ['Bash(*)'];
	} else if (execMode === 'deny_all') {
		execDeny = ['Bash(*)'];
	} else {
		// Custom mode - select specific commands
		const selectedAllowed = await p.multiselect({
			message: 'Select allowed commands (space to select, enter to confirm)',
			options: EXEC_COMMAND_OPTIONS,
			initialValues:
				existingConfig?.slots?.exec?.allow?.filter(a => a !== 'Bash(*)') || [],
			required: false,
		});

		if (p.isCancel(selectedAllowed)) {
			return selectedAllowed;
		}

		execAllow = selectedAllowed as string[];

		// Ask for denied commands from remaining
		const remainingCommands = EXEC_COMMAND_OPTIONS.filter(
			opt => !execAllow.includes(opt.value),
		);

		if (remainingCommands.length > 0) {
			const deniedCommands = await p.multiselect({
				message: 'Select denied commands (space to select, enter to confirm)',
				options: remainingCommands,
				initialValues:
					existingConfig?.slots?.exec?.deny?.filter(d => d !== 'Bash(*)') || [],
				required: false,
			});

			if (!p.isCancel(deniedCommands)) {
				execDeny = deniedCommands as string[];
			}
		}

		// Custom allow patterns
		const customAllowPatterns = await p.text({
			message:
				'Additional allow patterns (comma-separated, e.g. "docker *, kubectl *")',
			placeholder: 'Leave empty to skip',
			initialValue: '',
		});

		if (
			!p.isCancel(customAllowPatterns) &&
			customAllowPatterns &&
			customAllowPatterns.trim()
		) {
			const patterns = (customAllowPatterns as string)
				.split(',')
				.map(s => s.trim())
				.filter(Boolean)
				.map(s => (s.startsWith('Bash(') ? s : `Bash(${s})`));
			execAllow.push(...patterns);
		}

		// Custom deny patterns
		const customDenyPatterns = await p.text({
			message:
				'Additional deny patterns (comma-separated, e.g. "sudo *, rm -rf *")',
			placeholder: 'Leave empty to skip',
			initialValue: '',
		});

		if (
			!p.isCancel(customDenyPatterns) &&
			customDenyPatterns &&
			customDenyPatterns.trim()
		) {
			const patterns = (customDenyPatterns as string)
				.split(',')
				.map(s => s.trim())
				.filter(Boolean)
				.map(s => (s.startsWith('Bash(') ? s : `Bash(${s})`));
			execDeny.push(...patterns);
		}
	}

	return {allow: execAllow, deny: execDeny};
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
		validate: value => {
			if (value && !value.trim()) return 'Name is required';
		},
	});

	if (p.isCancel(name)) {
		p.cancel('Configuration cancelled');
		return {cancelled: true};
	}

	// Step 2: Description
	const description = await p.text({
		message: 'Description',
		placeholder: 'Browser and coding on my MacBook',
		initialValue: existingConfig?.description || '',
	});

	if (p.isCancel(description)) {
		p.cancel('Configuration cancelled');
		return {cancelled: true};
	}

	// Step 3: Check availability of all tools
	const checkSpinner = p.spinner();
	checkSpinner.start('Checking available tools...');

	const [claudeResult, browserInstalled] = await Promise.all([
		isClaudeCodeInstalled(),
		isPlaywrightReady(),
	]);

	checkSpinner.stop('Tools checked');

	// Build tool options based on availability
	const toolOptions: {value: ToolSlot; label: string; hint: string}[] = [
		{
			value: 'browser',
			label: 'Browser',
			hint: browserInstalled
				? chalk.green('available')
				: chalk.yellow('requires install'),
		},
		{
			value: 'coding',
			label: 'Coding',
			hint: claudeResult.installed
				? chalk.green('claude-code found')
				: chalk.yellow('claude-code not found'),
		},
		{
			value: 'exec',
			label: 'Exec',
			hint: 'Run shell commands',
		},
		{
			value: 'files',
			label: 'Files',
			hint: 'Read, write, edit, glob, grep',
		},
	];

	// Get currently enabled tools for initial values
	const currentlyEnabled: ToolSlot[] = [];
	if (existingConfig?.slots?.browser?.enabled) currentlyEnabled.push('browser');
	if (existingConfig?.slots?.coding?.enabled) currentlyEnabled.push('coding');
	if (existingConfig?.slots?.exec?.enabled) currentlyEnabled.push('exec');
	if (existingConfig?.slots?.files?.enabled) currentlyEnabled.push('files');

	// Step 4: Multi-select tools to configure
	const selectedTools = await p.multiselect({
		message: 'Which tools do you want to enable? (space to select, enter to confirm)',
		options: toolOptions,
		initialValues: currentlyEnabled,
		required: false,
	});

	if (p.isCancel(selectedTools)) {
		p.cancel('Configuration cancelled');
		return {cancelled: true};
	}

	const toolsToEnable = selectedTools as ToolSlot[];

	// Initialize slot config
	let browserEnabled = false;
	let codingEnabled = false;
	let execEnabled = false;
	let filesEnabled = false;
	let execAllow: string[] = [];
	let execDeny: string[] = [];
	let claudePath: string | undefined;

	// Configure each selected tool
	for (const tool of toolsToEnable) {
		switch (tool) {
			case 'browser': {
				if (!browserInstalled) {
					const installBrowser = await p.confirm({
						message: 'Browser tools require Playwright Chromium. Install now?',
						initialValue: true,
					});

					if (p.isCancel(installBrowser)) {
						p.cancel('Configuration cancelled');
						return {cancelled: true};
					}

					if (installBrowser) {
						const installSpinner = p.spinner();
						installSpinner.start('Installing Playwright Chromium...');
						try {
							const result = await installPlaywrightChromium();
							if (result.code === 0) {
								installSpinner.stop(chalk.green('Playwright Chromium installed'));
								browserEnabled = true;
							} else {
								installSpinner.stop(
									chalk.red('Installation failed - browser tools disabled'),
								);
							}
						} catch {
							installSpinner.stop(
								chalk.red('Installation failed - browser tools disabled'),
							);
						}
					}
				} else {
					browserEnabled = true;
				}
				break;
			}

			case 'coding': {
				if (!claudeResult.installed) {
					p.log.warn(
						chalk.yellow(
							'claude-code not found - coding tools will be disabled',
						),
					);
					p.log.info(
						chalk.dim('Install with: npm install -g @anthropic-ai/claude-code'),
					);
				} else {
					claudePath = claudeResult.path;
					codingEnabled = true;
				}
				break;
			}

			case 'exec': {
				p.log.step(chalk.cyan('Configuring exec tools...'));
				const execConfig = await configureExec(existingConfig);
				if (p.isCancel(execConfig)) {
					p.cancel('Configuration cancelled');
					return {cancelled: true};
				}
				execEnabled = true;
				execAllow = (execConfig as {allow: string[]; deny: string[]}).allow;
				execDeny = (execConfig as {allow: string[]; deny: string[]}).deny;
				break;
			}

			case 'files': {
				filesEnabled = true;
				break;
			}
		}
	}

	// Step 5: Configure folders (scoped workspaces for files/coding/exec)
	p.log.step(chalk.cyan('Configuring folders...'));
	const foldersResult = await configureFolders(existingConfig?.folders ?? []);
	if (p.isCancel(foldersResult)) {
		p.cancel('Configuration cancelled');
		return {cancelled: true};
	}
	const folders = foldersResult as StoredFolder[];

	// Save configuration
	const saveSpinner = p.spinner();
	saveSpinner.start('Saving configuration...');

	const gatewayId = existingConfig?.id || randomUUID();
	const slots: GatewaySlots = {
		browser: {enabled: browserEnabled},
		coding: {enabled: codingEnabled},
		exec: {
			enabled: execEnabled,
			allow: execAllow.length > 0 ? execAllow : undefined,
			deny: execDeny.length > 0 ? execDeny : undefined,
		},
		files: {enabled: filesEnabled},
	};

	const newConfig: GatewayConfig = {
		...prefs.gateway,
		id: gatewayId,
		name: name as string,
		description: (description as string) || '',
		pid: prefs.gateway?.pid || 0,
		startedAt: prefs.gateway?.startedAt || 0,
		slots,
		folders,
	};

	// Save coding config if enabled
	if (codingEnabled && claudePath) {
		const codingConfig = prefs.coding || {};
		if (!codingConfig['claude-code']) {
			codingConfig['claude-code'] = {
				command: claudePath,
				args: [
					'-p',
					'--output-format',
					'text',
					'--dangerously-skip-permissions',
				],
				resumeArgs: [
					'-p',
					'--output-format',
					'text',
					'--dangerously-skip-permissions',
					'--resume',
					'{sessionId}',
				],
				sessionArg: '--session-id',
				sessionMode: 'always',
				sessionIdFields: ['session_id'],
			};
		}
		updatePreferences({gateway: newConfig, coding: codingConfig});
	} else {
		updatePreferences({gateway: newConfig});
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
		p.outro(chalk.dim("Run 'corebrain gateway start' to start"));
		return {success: true, started: false};
	}

	// Start gateway
	const startSpinner = p.spinner();
	startSpinner.start('Starting gateway...');

	const serviceType = getServiceType();
	if (serviceType === 'none') {
		startSpinner.stop(chalk.red('Service management not supported'));
		return {
			success: true,
			started: false,
			error: 'Service management not supported',
		};
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
	await new Promise(resolve => setTimeout(resolve, 500));

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

	// Final step: offer to register the gateway (tunnel + securityKey).
	const wantRegister = await p.confirm({
		message: 'Register this gateway with a public URL now?',
		initialValue: true,
	});

	if (!p.isCancel(wantRegister) && wantRegister) {
		const result = await runRegister({});
		if (!result.ok) {
			if ('error' in result) {
				p.log.warn(`Registration failed: ${result.error}`);
				p.log.info('Re-run later with: corebrain gateway register');
			} else if ('cancelled' in result) {
				p.log.info('Registration skipped. Re-run later with: corebrain gateway register');
			}
		}
	} else {
		p.log.info('Skipped. Register later with: corebrain gateway register');
	}

	p.outro(chalk.green('Gateway is running!'));

	return {success: true, started: true};
}

async function runConfig(opts: zod.infer<typeof options>) {
	// Only show config if --show flag is explicitly passed
	if (opts.show) {
		return runDirectUpdate(opts);
	}

	// Otherwise always run interactive config
	return runInteractiveConfig();
}

export default function GatewayConfigCommand({options: opts}: Props) {
	const {exit} = useApp();
	const [status, setStatus] = useState<'running' | 'done' | 'error'>('running');
	const [error, setError] = useState('');

	useEffect(() => {
		let mounted = true;

		runConfig(opts)
			.then(result => {
				if (mounted) {
					if ('cancelled' in result && result.cancelled) {
						setStatus('done');
					} else if ('success' in result && result.success) {
						setStatus('done');
					} else {
						setError(('error' in result && result.error) || 'Unknown error');
						setStatus('error');
					}
				}
			})
			.catch(err => {
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
