#!/usr/bin/env node
import Pastel from 'pastel';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {dirname, join} from 'node:path';

// Get version from packages/cli/package.json, not workspace root
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const require = createRequire(import.meta.url);
const pkg = require(join(__dirname, '..', 'package.json')) as {version: string};

// Handle `tui` command before Pastel to avoid terminal conflicts with pi-tui
const args = process.argv.slice(2);

if (args[0] === 'tui') {
	const {startTuiApp} = await import('./tui/chat.js');
	const {getConfig} = await import('./config/index.js');

	const config = getConfig();
	const apiKey = config.auth?.apiKey;
	const baseUrl = config.auth?.url;

	if (!apiKey || !baseUrl) {
		console.error('Not authenticated. Run `corebrain login` first.');
		process.exit(1);
	}

	// startTuiApp is synchronous — pi-tui manages the process lifecycle
	// via its stdin listener. tui.addInputListener handles Ctrl+C → process.exit(0)
	startTuiApp(
		baseUrl
		apiKey,
		pkg.version,
	);
} else {
	const app = new Pastel({
		importMeta: import.meta,
		version: pkg.version,
		name: 'corebrain',
	});

	await app.run();
}
