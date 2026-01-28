import {homedir} from 'os';
import {join} from 'path';

export function getAppDataPath(): string {
	// Allow explicit override via environment variable
	if (process.env.CORE_DATA_DIR) {
		return process.env.CORE_DATA_DIR;
	}

	// Check XDG_DATA_HOME first (works cross-platform for testing)
	if (process.env.XDG_DATA_HOME) {
		return join(process.env.XDG_DATA_HOME, 'core');
	}

	// Platform-specific app data directories
	let baseAppDataPath: string;
	switch (process.platform) {
		case 'win32': {
			baseAppDataPath =
				process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming');
			break;
		}
		case 'darwin': {
			baseAppDataPath = join(homedir(), 'Library', 'Application Support');
			break;
		}
		default: {
			baseAppDataPath = join(homedir(), '.local', 'share');
		}
	}
	return join(baseAppDataPath, 'core');
}

export function getConfigPath(): string {
	// Allow explicit override via environment variable
	if (process.env.CORE_CONFIG_DIR) {
		return process.env.CORE_CONFIG_DIR;
	}

	// Platform-specific defaults
	let baseConfigPath: string;
	switch (process.platform) {
		case 'win32':
			baseConfigPath =
				process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming');
			break;
		case 'darwin':
			baseConfigPath = join(homedir(), 'Library', 'Preferences');
			break;
		default:
			baseConfigPath =
				process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config');
	}
	return join(baseConfigPath, 'core');
}
