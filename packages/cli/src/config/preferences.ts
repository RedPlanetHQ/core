import type { UserPreferences } from '@/types/config';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { getConfigPath } from '@/config/paths';

/**
 * Get the config.json file path
 */
function getConfigFilePath(): string {
	const configDir = getConfigPath();
	return join(configDir, 'config.json');
}

/**
 * Ensure config directory and file exist
 */
function ensureConfigFile(): string {
	const configDir = getConfigPath();
	const configPath = join(configDir, 'config.json');

	// Create directory if it doesn't exist
	if (!existsSync(configDir)) {
		mkdirSync(configDir, { recursive: true });
	}

	// Create config file if it doesn't exist
	if (!existsSync(configPath)) {
		writeFileSync(configPath, JSON.stringify({}, null, 2), 'utf-8');
	}

	return configPath;
}

/**
 * Load full config from config.json
 */
function loadFullConfig(): Record<string, unknown> {
	const configPath = ensureConfigFile();

	try {
		const rawData = readFileSync(configPath, 'utf-8');
		return JSON.parse(rawData) as Record<string, unknown>;
	} catch {
		return {};
	}
}

/**
 * Load user preferences from config.json (under "preferences" key)
 */
function loadPreferences(): UserPreferences {
	const config = loadFullConfig();
	return (config.preferences as UserPreferences) || {};
}

/**
 * Get current user preferences
 */
export function getPreferences(): UserPreferences {
	return loadPreferences();
}

/**
 * Update user preferences
 */
export function updatePreferences(newPreferences: Partial<UserPreferences>): void {
	const configPath = ensureConfigFile();

	try {
		const fullConfig = loadFullConfig();
		const currentPreferences = (fullConfig.preferences as UserPreferences) || {};
		const updatedPreferences = { ...currentPreferences, ...newPreferences };

		// Update preferences in full config
		fullConfig.preferences = updatedPreferences;

		writeFileSync(
			configPath,
			JSON.stringify(fullConfig, null, 2),
			'utf-8',
		);
	} catch (error) {
		console.warn('Failed to update preferences:', error);
	}
}

