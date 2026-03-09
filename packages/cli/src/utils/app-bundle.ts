import {execSync} from 'node:child_process';
import {
	existsSync,
	mkdirSync,
	writeFileSync,
	chmodSync,
} from 'node:fs';
import {join, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

const APP_NAME = 'CoreBrainGateway.app';
const APP_PATH = join('/Applications', APP_NAME);
const BUNDLE_ID = 'me.getcore.gateway';

export function getAppBundlePath(): string {
	return APP_PATH;
}

export function getAppExecutablePath(): string {
	return join(APP_PATH, 'Contents', 'MacOS', 'CoreBrainGateway');
}

export function isAppBundleInstalled(): boolean {
	return existsSync(getAppExecutablePath());
}

/**
 * Creates CoreBrainGateway.app in /Applications.
 * The executable inside is a shell script that launches the gateway-entry.js
 * under the .app's bundle identity — allowing the user to grant Full Disk
 * Access to the .app (which the file picker accepts), giving the gateway
 * process access to ~/Library/Messages/chat.db.
 */
export function createAppBundle(nodePath: string, gatewayEntryPath: string): void {
	const contentsDir = join(APP_PATH, 'Contents');
	const macosDir = join(contentsDir, 'MacOS');
	const executablePath = getAppExecutablePath();

	// Create directory structure
	mkdirSync(macosDir, {recursive: true});

	// Info.plist — gives the process a bundle identity TCC can track
	const infoPlist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>CFBundleIdentifier</key>
	<string>${BUNDLE_ID}</string>
	<key>CFBundleName</key>
	<string>CoreBrain Gateway</string>
	<key>CFBundleDisplayName</key>
	<string>CoreBrain Gateway</string>
	<key>CFBundleExecutable</key>
	<string>CoreBrainGateway</string>
	<key>CFBundleVersion</key>
	<string>1.0</string>
	<key>CFBundleShortVersionString</key>
	<string>1.0</string>
	<key>CFBundlePackageType</key>
	<string>APPL</string>
	<key>LSBackgroundOnly</key>
	<true/>
	<key>NSHighResolutionCapable</key>
	<true/>
</dict>
</plist>
`;

	writeFileSync(join(contentsDir, 'Info.plist'), infoPlist, 'utf-8');

	// Launcher script — the actual executable inside the .app
	const launcher = `#!/bin/bash
exec "${nodePath}" "${gatewayEntryPath}" "$@"
`;

	writeFileSync(executablePath, launcher, 'utf-8');
	chmodSync(executablePath, 0o755);
}

/**
 * Opens System Settings to Full Disk Access so user can add the .app.
 */
export function openFullDiskAccessSettings(): void {
	try {
		execSync(
			'open "x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles"',
			{stdio: 'ignore'},
		);
	} catch {
		// Fallback for older macOS
		try {
			execSync(
				'open "x-apple.systempreferences:com.apple.preference.security"',
				{stdio: 'ignore'},
			);
		} catch {}
	}
}

/**
 * Tests whether the .app (running as the current process's ancestor)
 * can access the Messages database. Returns true if accessible.
 */
export function testMessagesAccess(): boolean {
	const dbPath = join(process.env.HOME || '', 'Library/Messages/chat.db');
	if (!existsSync(dbPath)) return false;

	try {
		execSync(`sqlite3 "${dbPath}" "SELECT 1 LIMIT 1"`, {
			encoding: 'utf-8',
			stdio: ['pipe', 'pipe', 'pipe'],
		});
		return true;
	} catch {
		return false;
	}
}

/**
 * Get the gateway-entry.js path relative to this file.
 */
export function getGatewayEntryPath(): string {
	const __filename = fileURLToPath(import.meta.url);
	const __dirname = dirname(__filename);
	return join(__dirname, '..', 'server', 'gateway-entry.js');
}
