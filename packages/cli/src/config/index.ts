import type {AppConfig, Colors} from '@/types/index';
import {existsSync, readFileSync, mkdirSync, writeFileSync} from 'fs';
import {join, dirname} from 'path';
import {fileURLToPath} from 'url';
import {config as loadEnv} from 'dotenv';
import {logError} from '@/utils/message-queue';
import {getThemeColors, defaultTheme} from '@/config/themes';
import {substituteEnvVars} from '@/config/env-substitution';
import {getConfigPath} from '@/config/paths';

// Load .env file from working directory (shell environment takes precedence)
// Suppress dotenv console output by temporarily redirecting stdout
const envPath = join(process.cwd(), '.env');
if (existsSync(envPath)) {
	const originalWrite = process.stdout.write.bind(process.stdout);
	process.stdout.write = () => true;
	try {
		loadEnv({path: envPath});
	} finally {
		process.stdout.write = originalWrite;
	}
}

// Hold a map of what config files are where
export const confDirMap: Record<string, string> = {};

/**
 * Get the config.json file path, creating it if it doesn't exist
 */
export function getConfigFilePath(): string {
	const configDir = getConfigPath();
	const configPath = join(configDir, 'config.json');

	// Ensure directory exists
	if (!existsSync(configDir)) {
		mkdirSync(configDir, {recursive: true});
	}

	// Create config file if it doesn't exist
	if (!existsSync(configPath)) {
		writeFileSync(configPath, JSON.stringify({}, null, 2), 'utf-8');
	}

	confDirMap['config.json'] = configPath;
	return configPath;
}

// Find the closest config file for the requested configuration file
// Now simplified - always uses ~/.corebrain/config.json
export function getClosestConfigFile(fileName: string): string {
	try {
		const configDir = getConfigPath();

		// First, check for a working directory config (for local overrides)
		if (existsSync(join(process.cwd(), fileName))) {
			confDirMap[fileName] = join(process.cwd(), fileName);
			return join(process.cwd(), fileName);
		}

		// Use ~/.corebrain directory
		const configPath = join(configDir, fileName);

		// Ensure directory exists
		if (!existsSync(configDir)) {
			mkdirSync(configDir, {recursive: true});
		}

		// If the file doesn't exist, create it
		if (!existsSync(configPath)) {
			writeFileSync(configPath, JSON.stringify({}, null, 2), 'utf-8');
		}

		confDirMap[fileName] = configPath;
		return configPath;
	} catch (error) {
		logError(`Failed to load ${fileName}: ${String(error)}`);
	}

	// The code should never hit this, but it makes the TS compiler happy.
	return fileName;
}

// Function to load app configuration from config.json if it exists
function loadAppConfig(): AppConfig {
	const configJsonPath = getConfigFilePath();

	try {
		const rawData = readFileSync(configJsonPath, 'utf-8');
		const configData = JSON.parse(rawData) as {core?: AppConfig};

		// Apply environment variable substitution
		const processedData = substituteEnvVars(configData);

		if (processedData.core) {
			return {
				auth: processedData.core.auth,
				providers: processedData.core.providers ?? [],
			};
		}
	} catch {
		//
	}

	return {};
}

export let appConfig = loadAppConfig();

// Function to get current app configuration
export function getConfig(): AppConfig {
	return appConfig;
}

// Function to update app configuration
export function updateConfig(newConfig: Partial<AppConfig>): void {
	const configJsonPath = getConfigFilePath();

	try {
		// Read current config
		const rawData = readFileSync(configJsonPath, 'utf-8');
		const configData = JSON.parse(rawData) as {
			core?: AppConfig;
			preferences?: unknown;
		};

		// Update config
		if (!configData.core) {
			configData.core = {};
		}
		Object.assign(configData.core, newConfig);

		// Write back to file (preserving preferences)
		writeFileSync(configJsonPath, JSON.stringify(configData, null, 2), 'utf-8');

		// Reload config to update in-memory cache
		reloadAppConfig();
	} catch (error) {
		console.warn('Failed to update config:', error);
	}
}

// Function to reload the app configuration (useful after config file changes)
export function reloadAppConfig(): void {
	appConfig = loadAppConfig();
}

let cachedColors: Colors | null = null;

export function getColors(): Colors {
	if (!cachedColors) {
		const selectedTheme = defaultTheme;
		cachedColors = getThemeColors(selectedTheme);
	}
	return cachedColors;
}

// Legacy export for backwards compatibility - use a getter to avoid circular dependency
export const colors = new Proxy({} as Colors, {
	get(_target, prop) {
		return getColors()[prop as keyof Colors];
	},
});

// Get the package root directory (where this module is installed)
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
// Go up from dist/config to package root, then to source/app/prompts/main-prompt.md
// This works because source/app/prompts/main-prompt.md is included in the package.json files array
export const promptPath = join(
	__dirname,
	'../../source/app/prompts/main-prompt.md',
);
