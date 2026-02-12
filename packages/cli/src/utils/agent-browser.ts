import {spawn, execSync} from 'node:child_process';
import {existsSync, mkdirSync, rmSync, readdirSync} from 'node:fs';
import {join} from 'node:path';
import {homedir} from 'node:os';

// Constants
const SESSION_NAME = 'core';
const COREBRAIN_DIR = join(homedir(), '.corebrain');
const BROWSER_PROFILES_DIR = join(COREBRAIN_DIR, 'browser-profiles');

export interface CommandResult {
	stdout: string;
	stderr: string;
	code: number;
}

/**
 * Check if agent-browser is installed globally
 */
export async function isAgentBrowserInstalled(): Promise<boolean> {
	try {
		execSync('which agent-browser', {stdio: 'pipe'});
		return true;
	} catch {
		return false;
	}
}

/**
 * Install agent-browser globally via npm
 */
export async function installAgentBrowser(): Promise<CommandResult> {
	return runNpmCommand(['install', '-g', 'agent-browser']);
}

/**
 * Run an npm command
 */
function runNpmCommand(args: string[]): Promise<CommandResult> {
	return new Promise(resolve => {
		const proc = spawn('npm', args, {
			stdio: ['pipe', 'pipe', 'pipe'],
			shell: true,
		});

		let stdout = '';
		let stderr = '';

		proc.stdout?.on('data', data => {
			stdout += data.toString();
		});

		proc.stderr?.on('data', data => {
			stderr += data.toString();
		});

		proc.on('close', code => {
			resolve({stdout, stderr, code: code ?? 0});
		});

		proc.on('error', err => {
			resolve({stdout, stderr: err.message, code: 1});
		});
	});
}

/**
 * Run an agent-browser command with session
 */
export async function runAgentBrowserCommand(
	args: string[],
): Promise<CommandResult> {
	return new Promise(resolve => {
		const fullArgs = [...args, '--session', SESSION_NAME];
		const proc = spawn('agent-browser', fullArgs, {
			stdio: ['pipe', 'pipe', 'pipe'],
			shell: true,
		});

		let stdout = '';
		let stderr = '';

		proc.stdout?.on('data', data => {
			stdout += data.toString();
		});

		proc.stderr?.on('data', data => {
			stderr += data.toString();
		});

		proc.on('close', code => {
			resolve({stdout, stderr, code: code ?? 0});
		});

		proc.on('error', err => {
			resolve({stdout, stderr: err.message, code: 1});
		});
	});
}

/**
 * Get the session status
 */
export async function getSessionStatus(): Promise<
	'running' | 'stopped' | 'unknown'
> {
	const result = await runAgentBrowserCommand(['status']);

	if (result.code !== 0) {
		return 'unknown';
	}

	const output = result.stdout.toLowerCase();
	if (output.includes('running') || output.includes('active')) {
		return 'running';
	}

	return 'stopped';
}

// ============ Profile Management ============

/**
 * Create a browser profile directory
 */
export function createProfile(name: string): {
	success: boolean;
	path: string;
	error?: string;
} {
	const profilePath = join(BROWSER_PROFILES_DIR, name);

	try {
		if (existsSync(profilePath)) {
			return {
				success: false,
				path: profilePath,
				error: 'Profile already exists',
			};
		}

		mkdirSync(profilePath, {recursive: true});
		return {success: true, path: profilePath};
	} catch (err) {
		return {
			success: false,
			path: profilePath,
			error: err instanceof Error ? err.message : 'Failed to create profile',
		};
	}
}

/**
 * Delete a browser profile directory
 */
export function deleteProfile(name: string): {
	success: boolean;
	error?: string;
} {
	const profilePath = join(BROWSER_PROFILES_DIR, name);

	try {
		if (!existsSync(profilePath)) {
			return {success: false, error: 'Profile does not exist'};
		}

		rmSync(profilePath, {recursive: true, force: true});
		return {success: true};
	} catch (err) {
		return {
			success: false,
			error: err instanceof Error ? err.message : 'Failed to delete profile',
		};
	}
}

/**
 * List all browser profiles
 */
export function listProfiles(): string[] {
	try {
		if (!existsSync(BROWSER_PROFILES_DIR)) {
			return [];
		}

		return readdirSync(BROWSER_PROFILES_DIR, {withFileTypes: true})
			.filter(entry => entry.isDirectory())
			.map(entry => entry.name);
	} catch {
		return [];
	}
}

/**
 * Get the profiles directory path
 */
export function getProfilesDir(): string {
	return BROWSER_PROFILES_DIR;
}

/**
 * Get the session name used for browser sessions
 */
export function getSessionName(): string {
	return SESSION_NAME;
}

// ============ Core Actions ============

export async function browserOpen(
	url: string,
	options: {headed?: boolean; profile?: string} = {},
): Promise<CommandResult> {
	const args = ['open', url];
	if (options.headed) {
		args.push('--headed');
	}
	if (options.profile) {
		const profilePath = join(BROWSER_PROFILES_DIR, options.profile);
		if (existsSync(profilePath)) {
			args.push('--profile', profilePath);
		}
	}
	return runAgentBrowserCommand(args);
}

export async function browserClick(selector: string): Promise<CommandResult> {
	return runAgentBrowserCommand(['click', selector]);
}

export async function browserDblclick(
	selector: string,
): Promise<CommandResult> {
	return runAgentBrowserCommand(['dblclick', selector]);
}

export async function browserFill(
	selector: string,
	text: string,
): Promise<CommandResult> {
	return runAgentBrowserCommand(['fill', selector, text]);
}

export async function browserType(
	selector: string,
	text: string,
): Promise<CommandResult> {
	return runAgentBrowserCommand(['type', selector, text]);
}

export async function browserPress(key: string): Promise<CommandResult> {
	return runAgentBrowserCommand(['press', key]);
}

export async function browserHover(selector: string): Promise<CommandResult> {
	return runAgentBrowserCommand(['hover', selector]);
}

export async function browserSelect(
	selector: string,
	value: string,
): Promise<CommandResult> {
	return runAgentBrowserCommand(['select', selector, value]);
}

export async function browserCheck(selector: string): Promise<CommandResult> {
	return runAgentBrowserCommand(['check', selector]);
}

export async function browserUncheck(selector: string): Promise<CommandResult> {
	return runAgentBrowserCommand(['uncheck', selector]);
}

export async function browserScroll(
	direction: string,
	pixels?: number,
): Promise<CommandResult> {
	const args = ['scroll', direction];
	if (pixels !== undefined) {
		args.push(String(pixels));
	}
	return runAgentBrowserCommand(args);
}

export async function browserScreenshot(
	path?: string,
	full?: boolean,
): Promise<CommandResult> {
	const args = ['screenshot'];
	if (path) {
		args.push(path);
	}
	if (full) {
		args.push('--full');
	}
	return runAgentBrowserCommand(args);
}

export async function browserSnapshot(): Promise<CommandResult> {
	return runAgentBrowserCommand(['snapshot']);
}

export async function browserEval(script: string): Promise<CommandResult> {
	return runAgentBrowserCommand(['eval', script]);
}

export async function browserClose(): Promise<CommandResult> {
	return runAgentBrowserCommand(['close']);
}

// ============ Category-based Commands ============

/**
 * Get info: text, html, value, attr, title, url, count, box
 * Usage: get <subcommand> [selector] [extra]
 */
export async function browserGet(
	subcommand: string,
	args: string[] = [],
): Promise<CommandResult> {
	return runAgentBrowserCommand(['get', subcommand, ...args]);
}

/**
 * Check state: visible, enabled, checked
 * Usage: is <subcommand> <selector>
 */
export async function browserIs(
	subcommand: string,
	selector: string,
): Promise<CommandResult> {
	return runAgentBrowserCommand(['is', subcommand, selector]);
}

/**
 * Find elements: role, text, label, placeholder, testid, first, nth
 * Usage: find <locator> <value> <action> [actionValue]
 */
export async function browserFind(args: string[]): Promise<CommandResult> {
	return runAgentBrowserCommand(['find', ...args]);
}

/**
 * Wait: selector, time, or with flags (--text, --url, --load, --fn, --download)
 * Usage: wait <selector|ms> [options]
 */
export async function browserWait(args: string[]): Promise<CommandResult> {
	return runAgentBrowserCommand(['wait', ...args]);
}

/**
 * Mouse: move, down, up, wheel
 * Usage: mouse <subcommand> <args>
 */
export async function browserMouse(
	subcommand: string,
	args: string[] = [],
): Promise<CommandResult> {
	return runAgentBrowserCommand(['mouse', subcommand, ...args]);
}

/**
 * Settings: viewport, device, geo, offline, headers, credentials, media
 * Usage: set <subcommand> <args>
 */
export async function browserSet(
	subcommand: string,
	args: string[] = [],
): Promise<CommandResult> {
	return runAgentBrowserCommand(['set', subcommand, ...args]);
}

/**
 * Tabs: list, new, switch, close
 * Usage: tab [subcommand] [args]
 */
export async function browserTab(args: string[] = []): Promise<CommandResult> {
	return runAgentBrowserCommand(['tab', ...args]);
}

/**
 * Frames: switch to iframe or main
 * Usage: frame <selector|main>
 */
export async function browserFrame(target: string): Promise<CommandResult> {
	return runAgentBrowserCommand(['frame', target]);
}

/**
 * Navigation: back, forward, reload
 */
export async function browserNav(
	action: 'back' | 'forward' | 'reload',
): Promise<CommandResult> {
	return runAgentBrowserCommand([action]);
}

/**
 * Close: browser
 * Usage: close
 */
export async function closeBrowser(): Promise<CommandResult> {
	return runAgentBrowserCommand(['close']);
}
