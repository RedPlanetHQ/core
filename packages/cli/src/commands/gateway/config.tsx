import { useState, useEffect } from 'react';
import { Text, Box, useInput, useApp } from 'ink';
import TextInput from 'ink-text-input';
import SelectInput from 'ink-select-input';
import Spinner from 'ink-spinner';
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
import SuccessMessage from '@/components/success-message';
import ErrorMessage from '@/components/error-message';
import { ThemeContext } from '@/hooks/useTheme';
import { themeContextValue } from '@/config/themes';
import type { GatewayConfig, GatewaySlots } from '@/types/config';
import { isAgentBrowserInstalled, installAgentBrowser } from '@/utils/agent-browser';

const execAsync = promisify(exec);

export const options = zod.object({});

type Props = {
	options: zod.infer<typeof options>;
};

type Step =
	| 'checking'
	| 'confirm-edit'
	| 'uninstalling'
	| 'input-name'
	| 'input-description'
	| 'coding-check'
	| 'coding-ask'
	| 'browser-check'
	| 'browser-ask'
	| 'browser-install-ask'
	| 'browser-installing'
	| 'exec-ask'
	| 'exec-commands'
	| 'saving'
	| 'confirm-start'
	| 'starting'
	| 'started'
	| 'done'
	| 'cancelled'
	| 'error';

// Common exec command patterns
const EXEC_COMMAND_OPTIONS = [
	{ label: 'git status', value: 'Bash(git status)' },
	{ label: 'git diff', value: 'Bash(git diff *)' },
	{ label: 'git log', value: 'Bash(git log *)' },
	{ label: 'git branch', value: 'Bash(git branch *)' },
	{ label: 'git checkout', value: 'Bash(git checkout *)' },
	{ label: 'git add', value: 'Bash(git add *)' },
	{ label: 'git commit', value: 'Bash(git commit *)' },
	{ label: 'git push', value: 'Bash(git push *)' },
	{ label: 'git pull', value: 'Bash(git pull *)' },
	{ label: 'git fetch', value: 'Bash(git fetch *)' },
	{ label: 'git stash', value: 'Bash(git stash *)' },
	{ label: 'npm run *', value: 'Bash(npm run *)' },
	{ label: 'npm install', value: 'Bash(npm install *)' },
	{ label: 'npm test', value: 'Bash(npm test *)' },
	{ label: 'pnpm run *', value: 'Bash(pnpm run *)' },
	{ label: 'pnpm install', value: 'Bash(pnpm install *)' },
	{ label: 'yarn run *', value: 'Bash(yarn run *)' },
	{ label: 'ls', value: 'Bash(ls *)' },
	{ label: 'cat', value: 'Bash(cat *)' },
	{ label: 'head/tail', value: 'Bash(head *)|Bash(tail *)' },
	{ label: 'grep', value: 'Bash(grep *)' },
	{ label: 'find', value: 'Bash(find *)' },
	{ label: 'mkdir', value: 'Bash(mkdir *)' },
	{ label: 'rm', value: 'Bash(rm *)' },
	{ label: 'mv', value: 'Bash(mv *)' },
	{ label: 'cp', value: 'Bash(cp *)' },
	{ label: 'echo', value: 'Bash(echo *)' },
	{ label: 'curl', value: 'Bash(curl *)' },
	{ label: 'wget', value: 'Bash(wget *)' },
	{ label: 'python', value: 'Bash(python *)' },
	{ label: 'node', value: 'Bash(node *)' },
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

// Multi-select component for exec commands
function MultiSelect({
	items,
	onSubmit,
}: {
	items: { label: string; value: string }[];
	onSubmit: (allowed: string[], denied: string[]) => void;
}) {
	const [cursor, setCursor] = useState(0);
	const [allowed, setAllowed] = useState<Set<string>>(new Set());
	const [denied, setDenied] = useState<Set<string>>(new Set());

	useInput((input, key) => {
		if (key.upArrow) {
			setCursor((c) => Math.max(0, c - 1));
		} else if (key.downArrow) {
			setCursor((c) => Math.min(items.length - 1, c + 1));
		} else if (input === ' ') {
			// Toggle allow with space
			const value = items[cursor]!.value;
			setAllowed((prev) => {
				const next = new Set(prev);
				if (next.has(value)) {
					next.delete(value);
				} else {
					next.add(value);
					// Remove from denied if present
					setDenied((d) => {
						const nd = new Set(d);
						nd.delete(value);
						return nd;
					});
				}
				return next;
			});
		} else if (input === 'd' || input === 'D') {
			// Toggle deny with 'd'
			const value = items[cursor]!.value;
			setDenied((prev) => {
				const next = new Set(prev);
				if (next.has(value)) {
					next.delete(value);
				} else {
					next.add(value);
					// Remove from allowed if present
					setAllowed((a) => {
						const na = new Set(a);
						na.delete(value);
						return na;
					});
				}
				return next;
			});
		} else if (key.return) {
			// Expand compound values and submit
			const expandedAllowed: string[] = [];
			const expandedDenied: string[] = [];

			for (const v of allowed) {
				if (v.includes('|')) {
					expandedAllowed.push(...v.split('|'));
				} else {
					expandedAllowed.push(v);
				}
			}

			for (const v of denied) {
				if (v.includes('|')) {
					expandedDenied.push(...v.split('|'));
				} else {
					expandedDenied.push(v);
				}
			}

			onSubmit(expandedAllowed, expandedDenied);
		}
	});

	return (
		<Box flexDirection="column">
			<Text bold>Select commands to allow/deny:</Text>
			<Text dimColor>
				Space = Allow (green), D = Deny (red), Enter = Confirm
			</Text>
			<Text> </Text>
			{items.map((item, i) => {
				const isAllowed = allowed.has(item.value);
				const isDenied = denied.has(item.value);
				const isCursor = i === cursor;

				return (
					<Box key={item.value}>
						<Text color={isCursor ? 'cyan' : undefined}>
							{isCursor ? '❯ ' : '  '}
						</Text>
						<Text color={isAllowed ? 'green' : isDenied ? 'red' : undefined}>
							{isAllowed ? '[✓] ' : isDenied ? '[✗] ' : '[ ] '}
							{item.label}
						</Text>
					</Box>
				);
			})}
		</Box>
	);
}

export default function GatewayConfigCommand(_props: Props) {
	const { exit } = useApp();
	const [step, setStep] = useState<Step>('checking');
	const [error, setError] = useState('');
	const [existingConfig, setExistingConfig] = useState<GatewayConfig | null>(null);
	const [isEditing, setIsEditing] = useState(false);

	// Form state
	const [name, setName] = useState('');
	const [description, setDescription] = useState('');
	const [gatewayId, setGatewayId] = useState('');

	// Slot states
	const [claudePath, setClaudePath] = useState<string | null>(null);
	const [codingEnabled, setCodingEnabled] = useState(false);
	const [browserInstalled, setBrowserInstalled] = useState(false);
	const [browserEnabled, setBrowserEnabled] = useState(false);
	const [execEnabled, setExecEnabled] = useState(false);
	const [execAllow, setExecAllow] = useState<string[]>([]);
	const [execDeny, setExecDeny] = useState<string[]>([]);

	// Check for existing config on mount
	useEffect(() => {
		const prefs = getPreferences();
		const existing = prefs.gateway;

		if (existing?.id && existing?.name) {
			setExistingConfig(existing);
			setName(existing.name || '');
			setDescription(existing.description || '');
			setGatewayId(existing.id);
			// Load existing slot settings
			if (existing.slots) {
				setCodingEnabled(existing.slots.coding?.enabled || false);
				setBrowserEnabled(existing.slots.browser?.enabled || false);
				setExecEnabled(existing.slots.exec?.enabled || false);
				setExecAllow(existing.slots.exec?.allow || []);
				setExecDeny(existing.slots.exec?.deny || []);
			}
			setStep('confirm-edit');
		} else {
			// New config - generate ID
			setGatewayId(randomUUID());
			setStep('input-name');
		}
	}, []);

	// Handle edit confirmation
	const handleEditConfirm = async (item: { value: string }) => {
		if (item.value === 'edit') {
			setIsEditing(true);
			// Check if service is running and uninstall
			try {
				const serviceType = getServiceType();
				if (serviceType !== 'none') {
					const serviceName = getServiceName();
					const installed = await isServiceInstalled(serviceName);

					if (installed) {
						setStep('uninstalling');
						const status = await getServiceStatus(serviceName);
						if (status === 'running') {
							await stopService(serviceName);
							await new Promise((resolve) => setTimeout(resolve, 500));
						}
						await uninstallService(serviceName);
					}
				}
			} catch {
				// Continue anyway
			}
			setStep('input-name');
		} else if (item.value === 'view') {
			setStep('done');
		} else {
			setStep('cancelled');
		}
	};

	// Handle name submit
	const handleNameSubmit = (value: string) => {
		if (value.trim()) {
			setName(value.trim());
			setStep('input-description');
		}
	};

	// Handle description submit
	const handleDescriptionSubmit = (value: string) => {
		setDescription(value.trim());
		setStep('coding-check');
	};

	// Check for claude-code
	useEffect(() => {
		if (step === 'coding-check') {
			(async () => {
				const result = await isClaudeCodeInstalled();
				if (result.installed) {
					setClaudePath(result.path || null);
					setStep('coding-ask');
				} else {
					// Skip coding, go to browser
					setStep('browser-check');
				}
			})();
		}
	}, [step]);

	// Handle coding enable
	const handleCodingAsk = (item: { value: string }) => {
		setCodingEnabled(item.value === 'yes');
		setStep('browser-check');
	};

	// Check for browser
	useEffect(() => {
		if (step === 'browser-check') {
			(async () => {
				const installed = await isAgentBrowserInstalled();
				setBrowserInstalled(installed);
				if (installed) {
					setStep('browser-ask');
				} else {
					setStep('browser-install-ask');
				}
			})();
		}
	}, [step]);

	// Handle browser enable
	const handleBrowserAsk = (item: { value: string }) => {
		setBrowserEnabled(item.value === 'yes');
		setStep('exec-ask');
	};

	// Handle browser install ask
	const handleBrowserInstallAsk = async (item: { value: string }) => {
		if (item.value === 'yes') {
			// Check if npm is available
			const npmAvailable = await isNpmAvailable();
			if (!npmAvailable) {
				setError('npm is not available. Please install Node.js/npm first.');
				setStep('exec-ask'); // Skip browser, go to exec
				return;
			}
			setStep('browser-installing');
		} else {
			// Don't install, go to exec
			setStep('exec-ask');
		}
	};

	// Install browser
	useEffect(() => {
		if (step === 'browser-installing') {
			(async () => {
				try {
					const result = await installAgentBrowser();
					if (result.code === 0) {
						setBrowserInstalled(true);
						setBrowserEnabled(true);
						setStep('exec-ask');
					} else {
						setError(`Failed to install agent-browser: ${result.stderr}`);
						setStep('exec-ask');
					}
				} catch (err) {
					setError(err instanceof Error ? err.message : 'Failed to install');
					setStep('exec-ask');
				}
			})();
		}
	}, [step]);

	// Handle exec ask
	const handleExecAsk = (item: { value: string }) => {
		if (item.value === 'yes') {
			setExecEnabled(true);
			setStep('exec-commands');
		} else {
			setExecEnabled(false);
			setStep('saving');
		}
	};

	// Handle exec commands selection
	const handleExecCommandsSubmit = (allowed: string[], denied: string[]) => {
		setExecAllow(allowed);
		setExecDeny(denied);
		setStep('saving');
	};

	// Save config
	useEffect(() => {
		if (step === 'saving') {
			try {
				const prefs = getPreferences();
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
					name: name,
					description: description,
					port: prefs.gateway?.port || 0,
					pid: prefs.gateway?.pid || 0,
					startedAt: prefs.gateway?.startedAt || 0,
					slots,
				};

				// Also save coding config if enabled
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

				setStep('confirm-start');
			} catch (err) {
				setError(err instanceof Error ? err.message : 'Failed to save config');
				setStep('error');
			}
		}
	}, [step, gatewayId, name, description, codingEnabled, browserEnabled, execEnabled, execAllow, execDeny, claudePath]);

	// Handle start confirmation
	const handleStartConfirm = async (item: { value: string }) => {
		if (item.value === 'yes') {
			setStep('starting');

			try {
				const serviceType = getServiceType();
				if (serviceType === 'none') {
					setError('Service management not supported on this platform');
					setStep('error');
					return;
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

				// Wait a moment and get PID
				await new Promise((resolve) => setTimeout(resolve, 500));
				const pid = getServicePid(serviceName);

				// Update preferences with service info
				const prefs = getPreferences();
				updatePreferences({
					gateway: {
						...prefs.gateway,
						pid: pid ?? 0,
						startedAt: Date.now(),
						serviceInstalled: true,
						serviceType: serviceType,
						serviceName: serviceName,
					},
				});

				setStep('started');
			} catch (err) {
				setError(err instanceof Error ? err.message : 'Failed to start gateway');
				setStep('error');
			}
		} else {
			setStep('done');
		}
	};

	// Handle escape key
	useInput((input, key) => {
		if (key.escape) {
			setStep('cancelled');
		}
	});

	// Exit on done/cancelled/error/started
	useEffect(() => {
		if (step === 'cancelled' || step === 'done' || step === 'started' || step === 'error') {
			const timer = setTimeout(() => exit(), 100);
			return () => clearTimeout(timer);
		}
	}, [step, exit]);

	const editOptions = [
		{ label: 'Edit configuration', value: 'edit' },
		{ label: 'View current configuration', value: 'view' },
		{ label: 'Cancel', value: 'cancel' },
	];

	const yesNoOptions = [
		{ label: 'Yes', value: 'yes' },
		{ label: 'No', value: 'no' },
	];

	const startOptions = [
		{ label: 'Yes, start the gateway', value: 'yes' },
		{ label: 'No, I\'ll start it later', value: 'no' },
	];

	// Build summary of enabled slots
	const getSlotsummary = () => {
		const parts: string[] = [];
		if (codingEnabled) parts.push('Coding (claude-code)');
		if (browserEnabled) parts.push('Browser');
		if (execEnabled) {
			const allowCount = execAllow.length;
			const denyCount = execDeny.length;
			let execInfo = 'Exec';
			if (allowCount > 0 || denyCount > 0) {
				execInfo += ` (${allowCount} allowed, ${denyCount} denied)`;
			}
			parts.push(execInfo);
		}
		return parts.length > 0 ? parts.join(', ') : 'None';
	};

	return (
		<ThemeContext.Provider value={themeContextValue}>
			{step === 'checking' && <Text dimColor>Checking configuration...</Text>}

			{step === 'confirm-edit' && existingConfig && (
				<Box flexDirection="column">
					<Text bold color="cyan">Existing Gateway Configuration</Text>
					<Text> </Text>
					<Text>ID: {existingConfig.id}</Text>
					<Text>Name: {existingConfig.name}</Text>
					<Text>Description: {existingConfig.description || '(none)'}</Text>
					<Text>Slots: {getSlotsummary()}</Text>
					<Text> </Text>
					<Text>What would you like to do?</Text>
					<SelectInput items={editOptions} onSelect={handleEditConfirm} />
				</Box>
			)}

			{step === 'uninstalling' && (
				<Text dimColor>Stopping and uninstalling existing gateway...</Text>
			)}

			{step === 'input-name' && (
				<Box flexDirection="column">
					<Text bold color="cyan">Gateway Configuration</Text>
					<Text> </Text>
					<Box>
						<Text>Gateway Name: </Text>
						<TextInput
							value={name}
							onChange={setName}
							onSubmit={handleNameSubmit}
							placeholder="e.g., my-macbook-browser"
						/>
					</Box>
					<Text dimColor>
						{'\n'}Enter a unique name for this gateway (press Enter to confirm, Esc to cancel)
					</Text>
				</Box>
			)}

			{step === 'input-description' && (
				<Box flexDirection="column">
					<Text bold color="cyan">Gateway Configuration</Text>
					<Text> </Text>
					<Text dimColor>Name: {name}</Text>
					<Text> </Text>
					<Box>
						<Text>Description: </Text>
						<TextInput
							value={description}
							onChange={setDescription}
							onSubmit={handleDescriptionSubmit}
							placeholder="e.g., Browser automation and coding on my MacBook"
						/>
					</Box>
					<Text dimColor>
						{'\n'}Describe the role of this gateway. The meta-agent will use this to decide when to use it.
						{'\n'}(press Enter to confirm, Esc to cancel)
					</Text>
				</Box>
			)}

			{step === 'coding-check' && (
				<Box>
					<Text color="green"><Spinner type="dots" /></Text>
					<Text> Checking for claude-code...</Text>
				</Box>
			)}

			{step === 'coding-ask' && (
				<Box flexDirection="column">
					<Text bold color="cyan">Coding Slot</Text>
					<Text> </Text>
					<Text color="green">✓ Found claude-code at: {claudePath}</Text>
					<Text> </Text>
					<Text>Enable coding tools? (start/resume/read sessions)</Text>
					<SelectInput items={yesNoOptions} onSelect={handleCodingAsk} />
				</Box>
			)}

			{step === 'browser-check' && (
				<Box>
					<Text color="green"><Spinner type="dots" /></Text>
					<Text> Checking for agent-browser...</Text>
				</Box>
			)}

			{step === 'browser-ask' && (
				<Box flexDirection="column">
					<Text bold color="cyan">Browser Slot</Text>
					<Text> </Text>
					<Text color="green">✓ agent-browser is installed</Text>
					<Text> </Text>
					<Text>Enable browser tools? (open, click, fill, screenshot, etc.)</Text>
					<SelectInput items={yesNoOptions} onSelect={handleBrowserAsk} />
				</Box>
			)}

			{step === 'browser-install-ask' && (
				<Box flexDirection="column">
					<Text bold color="cyan">Browser Slot</Text>
					<Text> </Text>
					<Text color="yellow">⚠ agent-browser is not installed</Text>
					<Text> </Text>
					<Text>Would you like to install it? (npm install -g agent-browser)</Text>
					<SelectInput items={yesNoOptions} onSelect={handleBrowserInstallAsk} />
				</Box>
			)}

			{step === 'browser-installing' && (
				<Box>
					<Text color="green"><Spinner type="dots" /></Text>
					<Text> Installing agent-browser...</Text>
				</Box>
			)}

			{step === 'exec-ask' && (
				<Box flexDirection="column">
					<Text bold color="cyan">Exec Slot</Text>
					<Text> </Text>
					<Text>Enable exec tools? (run shell commands)</Text>
					<SelectInput items={yesNoOptions} onSelect={handleExecAsk} />
				</Box>
			)}

			{step === 'exec-commands' && (
				<Box flexDirection="column">
					<Text bold color="cyan">Exec Commands</Text>
					<Text> </Text>
					<MultiSelect items={EXEC_COMMAND_OPTIONS} onSubmit={handleExecCommandsSubmit} />
				</Box>
			)}

			{step === 'saving' && <Text dimColor>Saving configuration...</Text>}

			{step === 'starting' && <Text dimColor>Starting gateway service...</Text>}

			{step === 'started' && (
				<SuccessMessage
					message={`Gateway started!\n\nID: ${gatewayId}\nName: ${name}\nSlots: ${getSlotsummary()}\n\nUse 'corebrain gateway status' to check status.\nUse 'corebrain gateway off' to stop.`}
				/>
			)}

			{step === 'confirm-start' && (
				<Box flexDirection="column">
					<SuccessMessage
						message={`Gateway configured!\n\nID: ${gatewayId}\nName: ${name}\nDescription: ${description || '(none)'}\nSlots: ${getSlotsummary()}`}
					/>
					<Text> </Text>
					<Text>Would you like to start the gateway now?</Text>
					<SelectInput items={startOptions} onSelect={handleStartConfirm} />
				</Box>
			)}

			{step === 'done' && !isEditing && existingConfig && (
				<Box flexDirection="column">
					<Text bold color="cyan">Current Gateway Configuration</Text>
					<Text> </Text>
					<Text>ID: {existingConfig.id}</Text>
					<Text>Name: {existingConfig.name}</Text>
					<Text>Description: {existingConfig.description || '(none)'}</Text>
					<Text>Slots: {getSlotsummary()}</Text>
					<Text> </Text>
					<Text dimColor>Run 'corebrain gateway on' to start the gateway</Text>
				</Box>
			)}

			{step === 'done' && (isEditing || !existingConfig) && (
				<Box flexDirection="column">
					<SuccessMessage
						message={`Gateway configured!\n\nID: ${gatewayId}\nName: ${name}\nDescription: ${description || '(none)'}\nSlots: ${getSlotsummary()}`}
					/>
					<Text> </Text>
					<Text dimColor>Run 'corebrain gateway on' to start the gateway</Text>
				</Box>
			)}

			{step === 'cancelled' && (
				<Text dimColor>Configuration cancelled.</Text>
			)}

			{step === 'error' && <ErrorMessage message={error} />}
		</ThemeContext.Provider>
	);
}
