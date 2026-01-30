import type { UserPreferences } from '@/types/config';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { getClosestConfigFile } from '@/config/index';

const PREFERENCES_FILE = 'preferences.json';

/**
 * Load user preferences from preferences.json
 */
function loadPreferences(): UserPreferences {
	const preferencesPath = getClosestConfigFile(PREFERENCES_FILE);

	try {
		if (!existsSync(preferencesPath)) {
			return {};
		}

		const rawData = readFileSync(preferencesPath, 'utf-8');
		return JSON.parse(rawData) as UserPreferences;
	} catch {
		return {};
	}
}

let cachedPreferences: UserPreferences | null = null;

/**
 * Get current user preferences
 */
export function getPreferences(): UserPreferences {
	if (!cachedPreferences) {
		cachedPreferences = loadPreferences();
	}
	return cachedPreferences;
}

/**
 * Update user preferences
 */
export function updatePreferences(newPreferences: Partial<UserPreferences>): void {
	const preferencesPath = getClosestConfigFile(PREFERENCES_FILE);

	try {
		const currentPreferences = loadPreferences();
		const updatedPreferences = { ...currentPreferences, ...newPreferences };

		writeFileSync(
			preferencesPath,
			JSON.stringify(updatedPreferences, null, 2),
			'utf-8',
		);

		// Update cache
		cachedPreferences = updatedPreferences;
	} catch (error) {
		console.warn('Failed to update preferences:', error);
	}
}

/**
 * Reload preferences from disk (useful after external changes)
 */
export function reloadPreferences(): void {
	cachedPreferences = loadPreferences();
}
