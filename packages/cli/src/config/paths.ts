import {homedir} from 'os';
import {join} from 'path';

// Single config directory for all platforms: ~/.corebrain
const CONFIG_DIR = join(homedir(), '.corebrain');

export function getAppDataPath(): string {
	// Allow explicit override via environment variable
	if (process.env.CORE_DATA_DIR) {
		return process.env.CORE_DATA_DIR;
	}

	return CONFIG_DIR;
}

export function getConfigPath(): string {
	// Allow explicit override via environment variable
	if (process.env.CORE_CONFIG_DIR) {
		return process.env.CORE_CONFIG_DIR;
	}

	return CONFIG_DIR;
}
