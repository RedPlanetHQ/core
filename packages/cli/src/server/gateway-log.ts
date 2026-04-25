import {writeFileSync, mkdirSync, existsSync} from 'node:fs';
import {join} from 'node:path';
import {getConfigPath} from '@/config/paths';

const LOG_DIR = join(getConfigPath(), 'logs');
const LOG_FILE = join(LOG_DIR, 'gateway.log');

let ensured = false;
function ensureDir(): void {
	if (ensured) return;
	if (!existsSync(LOG_DIR)) {
		mkdirSync(LOG_DIR, {recursive: true});
	}
	ensured = true;
}

/**
 * Append a line to `~/.corebrain/logs/gateway.log`. Safe to call from any
 * module in the gateway process — shared with the daemon entrypoint's own
 * logger so everything ends up in one place.
 *
 * Falls back to stderr if the file isn't writable.
 */
export function gatewayLog(message: string): void {
	ensureDir();
	const line = `[${new Date().toISOString()}] ${message}\n`;
	try {
		writeFileSync(LOG_FILE, line, {flag: 'a'});
	} catch {
		process.stderr.write(line);
	}
}

export const GATEWAY_LOG_FILE = LOG_FILE;
