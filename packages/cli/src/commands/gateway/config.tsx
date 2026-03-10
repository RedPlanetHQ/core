import {useEffect, useState} from 'react';
import {Text, useApp} from 'ink';
import * as p from '@clack/prompts';
import chalk from 'chalk';
import zod from 'zod';
import {randomUUID} from 'node:crypto';
import {exec} from 'node:child_process';
import {promisify} from 'node:util';
import {existsSync} from 'node:fs';
import {getPreferences, updatePreferences} from '@/config/preferences';
import {getConfig} from '@/config/index';
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
import {join, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {homedir} from 'node:os';
import type {GatewayConfig, GatewaySlots} from '@/types/config';
import {
	isAgentBrowserInstalled,
	installAgentBrowser,
} from '@/utils/agent-browser';
import {
	createAppBundle,
	openFullDiskAccessSettings,
	testMessagesAccess,
	isAppBundleInstalled,
	getAppExecutablePath,
	getAppBundlePath,
} from '@/utils/app-bundle';

const execAsync = promisify(exec);

const DEFAULT_APP_URL = 'https://app.getcore.me';

// Tool slot definitions
type ToolSlot = 'browser' | 'coding' | 'exec' | 'imessage';

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
	imessage: zod.boolean().optional().describe('Enable/disable iMessage tools'),
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

// Check if iMessage database is accessible
async function isIMessageAvailable(): Promise<{
	available: boolean;
	message?: string;
}> {
	const dbPath = join(homedir(), 'Library/Messages/chat.db');
	if (!existsSync(dbPath)) {
		return {available: false, message: 'Messages database not found'};
	}

	try {
		await execAsync(`sqlite3 "${dbPath}" "SELECT 1 LIMIT 1"`);
		return {available: true};
	} catch {
		return {
			available: false,
			message:
				'Grant Full Disk Access to terminal in System Settings > Privacy & Security',
		};
	}
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
		`${chalk.bold('URL:')} ${config.url || DEFAULT_APP_URL}`,
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
		`${chalk.bold('iMessage:')} ${
			config.slots?.imessage?.enabled
				? chalk.green('enabled')
				: chalk.dim('disabled')
		}`,
	].join('\n');
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
	if (opts.imessage !== undefined) {
		slots.imessage = {...slots.imessage, enabled: opts.imessage};
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
			message: 'Select allowed commands (space to toggle)',
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
				message: 'Select denied commands (optional)',
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

// Configure iMessage slot — creates .app bundle and guides FDA setup
// Returns true if enabled, false if skipped, null if cancelled
async function configureIMessage(): Promise<boolean | null> {
	// If already installed and accessible, just enable
	if (isAppBundleInstalled() && testMessagesAccess()) {
		p.log.success(
			chalk.green(
				'CoreBrainGateway.app already installed and has Full Disk Access',
			),
		);
		return true;
	}

	p.log.step(chalk.cyan('Setting up iMessage access...'));

	// Step 1: Create the .app bundle
	const bundleSpinner = p.spinner();
	bundleSpinner.start('Creating CoreBrainGateway.app in /Applications...');
	try {
		const __filename = fileURLToPath(import.meta.url);
		const __dirname = dirname(__filename);
		const gatewayEntryPath = join(
			__dirname,
			'..',
			'..',
			'server',
			'gateway-entry.js',
		);
		createAppBundle(process.execPath, gatewayEntryPath);
		bundleSpinner.stop(
			chalk.green('CoreBrainGateway.app created in /Applications'),
		);
	} catch (err) {
		bundleSpinner.stop(chalk.red('Failed to create app bundle'));
		p.log.error(err instanceof Error ? err.message : 'Unknown error');
		return false;
	}

	// Step 2: Open System Settings → Full Disk Access
	openFullDiskAccessSettings();

	p.log.info(
		[
			'',
			chalk.bold('Grant Full Disk Access to CoreBrain Gateway:'),
			`  1. In the panel that just opened, click ${chalk.bold('+')}`,
			`  2. Select ${chalk.bold('CoreBrainGateway')} from Applications`,
			`  3. Make sure the toggle is ${chalk.bold('ON')}`,
			'',
		].join('\n'),
	);

	// Step 3: Wait for user then verify
	let verified = false;
	while (!verified) {
		const next = await p.select({
			message: "Once you've added CoreBrainGateway to Full Disk Access:",
			options: [
				{value: 'verify', label: 'Verify access'},
				{value: 'skip', label: 'Skip iMessage for now'},
			],
		});

		if (p.isCancel(next)) return null;

		if (next === 'skip') return false;

		const verifySpinner = p.spinner();
		verifySpinner.start('Checking Full Disk Access...');
		const ok = testMessagesAccess();
		if (ok) {
			verifySpinner.stop(
				chalk.green('Full Disk Access confirmed — iMessage tools ready'),
			);
			verified = true;
		} else {
			verifySpinner.stop(
				chalk.yellow('Not yet — Messages database not accessible'),
			);
			p.log.warn(
				`Make sure ${chalk.bold(
					getAppBundlePath(),
				)} is in Full Disk Access with the toggle ON, then try again.`,
			);
		}
	}

	return true;
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

	const [claudeResult, browserInstalled, imessageResult] = await Promise.all([
		isClaudeCodeInstalled(),
		isAgentBrowserInstalled(),
		isIMessageAvailable(),
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
			value: 'imessage',
			label: 'iMessage',
			hint: imessageResult.available
				? chalk.green('available')
				: chalk.yellow(imessageResult.message || 'not available'),
		},
	];

	// Get currently enabled tools for initial values
	const currentlyEnabled: ToolSlot[] = [];
	if (existingConfig?.slots?.browser?.enabled) currentlyEnabled.push('browser');
	if (existingConfig?.slots?.coding?.enabled) currentlyEnabled.push('coding');
	if (existingConfig?.slots?.exec?.enabled) currentlyEnabled.push('exec');
	if (existingConfig?.slots?.imessage?.enabled)
		currentlyEnabled.push('imessage');

	// Step 4: Multi-select tools to configure
	const selectedTools = await p.multiselect({
		message: 'Which tools do you want to enable?',
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
	let imessageEnabled: boolean = false;
	let execAllow: string[] = [];
	let execDeny: string[] = [];
	let claudePath: string | undefined;

	// Configure each selected tool
	for (const tool of toolsToEnable) {
		switch (tool) {
			case 'browser': {
				if (!browserInstalled) {
					const installBrowser = await p.confirm({
						message: 'Browser tools require agent-browser. Install now?',
						initialValue: true,
					});

					if (p.isCancel(installBrowser)) {
						p.cancel('Configuration cancelled');
						return {cancelled: true};
					}

					if (installBrowser) {
						const installSpinner = p.spinner();
						installSpinner.start('Installing agent-browser...');
						try {
							const result = await installAgentBrowser();
							if (result.code === 0) {
								installSpinner.stop(chalk.green('agent-browser installed'));
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

			case 'imessage': {
				const result = await configureIMessage();
				if (result === null) {
					p.cancel('Configuration cancelled');
					return {cancelled: true};
				}
				imessageEnabled = result;
				break;
			}
		}
	}

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
		imessage: {enabled: imessageEnabled},
	};

	// Get URL from auth config (set during login)
	const appConfig = getConfig();
	const authUrl = appConfig.auth?.url || DEFAULT_APP_URL;

	const newConfig: GatewayConfig = {
		...prefs.gateway,
		id: gatewayId,
		name: name as string,
		description: (description as string) || '',
		url: authUrl,
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

	// If iMessage is enabled, launch via the .app bundle so it inherits Full Disk Access
	const useAppBundle = imessageEnabled && isAppBundleInstalled();
	const serviceConfig: ServiceConfig = {
		name: serviceName,
		displayName: 'CoreBrain Gateway',
		command: useAppBundle ? getAppExecutablePath() : process.execPath,
		args: useAppBundle ? [] : [gatewayEntryPath],
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
