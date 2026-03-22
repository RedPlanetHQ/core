import {spawn} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {getPreferences, updatePreferences} from '@/config/preferences';
import type {BrowserType, BrowserSessionConfig} from '@/types/config';

// Constants
const MAX_PROFILES = 5;
const MAX_SESSIONS = 10;
const DEFAULT_PROFILES = ['personal', 'work', 'misc'];

// ============ Browser Executable Paths ============

const BRAVE_PATHS: Record<string, string[]> = {
	darwin: ['/Applications/Brave Browser.app/Contents/MacOS/Brave Browser'],
	linux: ['/usr/bin/brave-browser', '/usr/bin/brave', '/snap/bin/brave'],
	win32: [
		'C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe',
		'C:\\Program Files (x86)\\BraveSoftware\\Brave-Browser\\Application\\brave.exe',
	],
};

const CHROME_PATHS: Record<string, string[]> = {
	darwin: ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'],
	linux: ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable'],
	win32: [
		'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
		'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
	],
};

export type {BrowserType, BrowserSessionConfig} from '@/types/config';

// ============ Profile Management ============

export function getConfiguredProfiles(): string[] {
	const prefs = getPreferences();
	const profiles = prefs.browser?.profiles;
	if (profiles && profiles.length > 0) return profiles;

	// Migrate: if old sessions were strings, derive profiles from them
	const raw = (prefs.browser?.sessions || []) as unknown[];
	const oldStrings = raw.filter((s): s is string => typeof s === 'string');
	if (oldStrings.length > 0) {
		const derived = [...new Set(oldStrings)];
		updatePreferences({browser: {...prefs.browser, profiles: derived}});
		return derived;
	}

	return [];
}

export function isProfileConfigured(name: string): boolean {
	return getConfiguredProfiles().includes(name);
}

export function createProfile(name: string): {success: boolean; error?: string} {
	if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
		return {
			success: false,
			error: 'Profile name must contain only alphanumeric characters, hyphens, and underscores',
		};
	}

	const prefs = getPreferences();
	const current = prefs.browser?.profiles || [];

	if (current.includes(name)) {
		return {success: false, error: `Profile "${name}" already exists`};
	}

	if (current.length >= MAX_PROFILES) {
		return {
			success: false,
			error: `Maximum ${MAX_PROFILES} profiles allowed. Current: ${current.join(', ')}`,
		};
	}

	updatePreferences({
		browser: {...prefs.browser, profiles: [...current, name]},
	});

	return {success: true};
}

export function deleteProfile(name: string): {success: boolean; error?: string} {
	const prefs = getPreferences();
	const current = prefs.browser?.profiles || [];

	if (!current.includes(name)) {
		return {success: false, error: `Profile "${name}" does not exist`};
	}

	// Remove sessions bound to this profile
	const sessions = prefs.browser?.sessions || [];
	const remainingSessions = sessions.filter(s => s.profile !== name);

	updatePreferences({
		browser: {
			...prefs.browser,
			profiles: current.filter(p => p !== name),
			sessions: remainingSessions,
		},
	});

	// Delete profile dir from disk
	const profileDir = getProfileDir(name);
	if (fs.existsSync(profileDir)) {
		fs.rmSync(profileDir, {recursive: true, force: true});
	}

	return {success: true};
}

export function initializeDefaultProfiles(): void {
	const prefs = getPreferences();
	const current = prefs.browser?.profiles || [];

	if (current.length === 0) {
		updatePreferences({
			browser: {...prefs.browser, profiles: [...DEFAULT_PROFILES]},
		});
	}
}

// ============ Session Management ============

export function getConfiguredSessions(): BrowserSessionConfig[] {
	const prefs = getPreferences();
	const raw = (prefs.browser?.sessions || []) as unknown[];
	// Migrate old string[] format to BrowserSessionConfig[]
	const migrated = raw.map(s =>
		typeof s === 'string' ? {name: s, profile: 'personal'} : (s as BrowserSessionConfig),
	);
	// If migration happened, persist the new format
	if (raw.some(s => typeof s === 'string')) {
		updatePreferences({browser: {...prefs.browser, sessions: migrated}});
	}
	return migrated;
}

export function isSessionConfigured(name: string): boolean {
	return getConfiguredSessions().some(s => s.name === name);
}

export function getSessionConfig(name: string): BrowserSessionConfig | undefined {
	return getConfiguredSessions().find(s => s.name === name);
}

export function createSession(
	name: string,
	profile: string,
): {success: boolean; error?: string} {
	if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
		return {
			success: false,
			error: 'Session name must contain only alphanumeric characters, hyphens, and underscores',
		};
	}

	if (!isProfileConfigured(profile)) {
		const profiles = getConfiguredProfiles();
		return {
			success: false,
			error: `Profile "${profile}" does not exist. Available: ${profiles.join(', ')}`,
		};
	}

	const prefs = getPreferences();
	const current = prefs.browser?.sessions || [];

	if (current.some(s => s.name === name)) {
		return {success: false, error: `Session "${name}" already exists`};
	}

	if (current.length >= MAX_SESSIONS) {
		return {
			success: false,
			error: `Maximum ${MAX_SESSIONS} sessions allowed`,
		};
	}

	updatePreferences({
		browser: {
			...prefs.browser,
			sessions: [...current, {name, profile}],
		},
	});

	return {success: true};
}

export function deleteSession(name: string): {success: boolean; error?: string} {
	const prefs = getPreferences();
	const current = prefs.browser?.sessions || [];

	if (!current.some(s => s.name === name)) {
		return {success: false, error: `Session "${name}" does not exist`};
	}

	updatePreferences({
		browser: {
			...prefs.browser,
			sessions: current.filter(s => s.name !== name),
		},
	});

	return {success: true};
}

// ============ Profile Directory ============

export function getProfileDir(profileName: string): string {
	return path.join(os.homedir(), '.corebrain', 'browser-profiles', profileName);
}

// ============ Browser Executable Management ============

export function detectBravePath(): string | null {
	const platform = process.platform as 'darwin' | 'linux' | 'win32';
	const paths = BRAVE_PATHS[platform] || [];
	for (const p of paths) {
		if (fs.existsSync(p)) return p;
	}
	return null;
}

export function detectChromePath(): string | null {
	const platform = process.platform as 'darwin' | 'linux' | 'win32';
	const paths = CHROME_PATHS[platform] || [];
	for (const p of paths) {
		if (fs.existsSync(p)) return p;
	}
	return null;
}

export function detectAvailableBrowsers(): {type: BrowserType; path: string}[] {
	const browsers: {type: BrowserType; path: string}[] = [];
	const bravePath = detectBravePath();
	if (bravePath) browsers.push({type: 'brave', path: bravePath});
	const chromePath = detectChromePath();
	if (chromePath) browsers.push({type: 'chrome', path: chromePath});
	return browsers;
}

export function getBrowserExecutable(): {type: BrowserType; path?: string} {
	const prefs = getPreferences();
	return {
		type: prefs.browser?.browserType || 'default',
		path: prefs.browser?.browserExecutable,
	};
}

export function setBrowserExecutable(
	type: BrowserType,
	customPath?: string,
): {success: boolean; error?: string} {
	const prefs = getPreferences();
	let browserExecutable: string | undefined;

	if (type === 'default') {
		browserExecutable = undefined;
	} else if (type === 'brave') {
		const bravePath = detectBravePath();
		if (!bravePath) {
			return {success: false, error: 'Brave browser not found. Install it or use custom path.'};
		}
		browserExecutable = bravePath;
	} else if (type === 'chrome') {
		const chromePath = detectChromePath();
		if (!chromePath) {
			return {success: false, error: 'Chrome browser not found. Install it or use custom path.'};
		}
		browserExecutable = chromePath;
	} else if (type === 'custom') {
		if (!customPath) return {success: false, error: 'Custom path is required'};
		if (!fs.existsSync(customPath)) {
			return {success: false, error: `Browser not found at: ${customPath}`};
		}
		browserExecutable = customPath;
	}

	updatePreferences({
		browser: {
			...prefs.browser,
			browserType: type,
			browserExecutable,
		},
	});

	return {success: true};
}

export function getMaxProfiles(): number {
	return MAX_PROFILES;
}

export function getMaxSessions(): number {
	return MAX_SESSIONS;
}

export function getDefaultProfiles(): string[] {
	return DEFAULT_PROFILES;
}

// ============ Playwright Readiness ============

export interface CommandResult {
	stdout: string;
	stderr: string;
	code: number;
}

function runShellCommand(command: string): Promise<CommandResult> {
	return new Promise(resolve => {
		const proc = spawn(command, [], {
			stdio: ['pipe', 'pipe', 'pipe'],
			shell: true,
		});

		let stdout = '';
		let stderr = '';

		proc.stdout?.on('data', (data: Buffer) => {
			stdout += data.toString();
		});

		proc.stderr?.on('data', (data: Buffer) => {
			stderr += data.toString();
		});

		proc.on('close', (code: number | null) => {
			resolve({stdout, stderr, code: code ?? 0});
		});

		proc.on('error', (err: Error) => {
			resolve({stdout, stderr: err.message, code: 1});
		});
	});
}

export async function isPlaywrightReady(): Promise<boolean> {
	try {
		const {chromium} = await import('playwright');
		return fs.existsSync(chromium.executablePath());
	} catch {
		return false;
	}
}

export async function installPlaywrightChromium(): Promise<CommandResult> {
	const result = await runShellCommand('npx playwright install chromium');
	if (result.code === 0) {
		initializeDefaultProfiles();
	}
	return result;
}

export async function getPlaywrightVersion(): Promise<CommandResult> {
	return runShellCommand('npx playwright --version');
}
