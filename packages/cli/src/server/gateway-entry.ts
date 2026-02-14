#!/usr/bin/env node
/**
 * Gateway client entry point - runs as a detached background process via launchd/systemd
 * Connects to the remote WebSocket server and handles tool calls
 */

import {writeFileSync, mkdirSync, existsSync, statSync, unlinkSync} from 'node:fs';
import {join} from 'node:path';
import {hostname} from 'node:os';
import {GatewayClient} from './gateway-client.js';
import {getConfig} from '../config/index.js';
import {getPreferences, updatePreferences} from '../config/preferences.js';
import {getConfigPath} from '../config/paths.js';

const LOG_DIR = join(getConfigPath(), 'logs');
const LOG_FILE = join(LOG_DIR, 'gateway.log');
const LOG_MAX_AGE_DAYS = 3;

// Ensure log directory exists
if (!existsSync(LOG_DIR)) {
	mkdirSync(LOG_DIR, {recursive: true});
}

/**
 * Clear log file if it's older than LOG_MAX_AGE_DAYS
 */
function clearOldLogs(): void {
	try {
		if (!existsSync(LOG_FILE)) {
			return;
		}

		const stats = statSync(LOG_FILE);
		const ageMs = Date.now() - stats.mtime.getTime();
		const maxAgeMs = LOG_MAX_AGE_DAYS * 24 * 60 * 60 * 1000;

		if (ageMs > maxAgeMs) {
			unlinkSync(LOG_FILE);
			// Create fresh log file with rotation notice
			writeFileSync(LOG_FILE, `[${new Date().toISOString()}] Log file cleared (was older than ${LOG_MAX_AGE_DAYS} days)\n`);
		}
	} catch {
		// Ignore errors during log rotation
	}
}

function log(message: string) {
	const timestamp = new Date().toISOString();
	const logMessage = `[${timestamp}] ${message}\n`;

	try {
		writeFileSync(LOG_FILE, logMessage, {flag: 'a'});
	} catch {
		// If logging fails, at least try stderr
		process.stderr.write(logMessage);
	}
}

async function main() {
	// Clear old logs at startup
	clearOldLogs();

	log(`Starting gateway client...`);

	// Load config and preferences
	const config = getConfig();
	const prefs = getPreferences();
	const gatewayConfig = prefs.gateway;

	// Get gateway info from preferences (set by `corebrain gateway config`)
	const gatewayId = gatewayConfig?.id;
	const gatewayName = gatewayConfig?.name || `${hostname()}-browser`;
	const gatewayDescription = gatewayConfig?.description || 'Browser automation gateway';

	log(`ID: ${gatewayId || '(not set)'}`);
	log(`Name: ${gatewayName}`);
	log(`Description: ${gatewayDescription}`);

	if (!config.auth?.apiKey || !config.auth?.url) {
		log('ERROR: Not authenticated. Run `corebrain login` first.');
		process.exit(1);
	}

	if (!gatewayId) {
		log('WARNING: Gateway not configured. Run `corebrain gateway config` first.');
	}

	log(`Connecting to: ${config.auth.url}`);

	// Create gateway client
	const client = new GatewayClient({
		url: config.auth.url,
		apiKey: config.auth.apiKey,
		gatewayId: gatewayId,
		name: gatewayName,
		description: gatewayDescription,
		logger: log, // Pass logger to GatewayClient for tool call logging
		onConnect: () => {
			log('Connected to gateway server');
		},
		onReady: (gatewayId) => {
			log(`Gateway ready with ID: ${gatewayId}`);
			log(`PID: ${process.pid}`);
		},
		onDisconnect: () => {
			log('Disconnected from gateway server, will attempt reconnection...');
		},
		onError: (error) => {
			log(`Gateway error: ${error.message}`);
		},
		onMaxReconnectReached: () => {
			log('Max reconnection attempts (10) reached. Updating status and shutting down...');

			// Update gateway status to disconnected
			const currentPrefs = getPreferences();
			if (currentPrefs.gateway) {
				updatePreferences({
					gateway: {
						...currentPrefs.gateway,
						pid: 0,
						startedAt: 0,
						serviceInstalled: false,
					},
				});
			}

			log('Gateway status updated to disconnected. Exiting...');
			process.exit(1);
		},
	});

	// Connect
	client.connect();

	// Handle graceful shutdown
	const shutdown = () => {
		log('Shutting down gateway client...');
		client.disconnect();
		process.exit(0);
	};

	process.on('SIGTERM', shutdown);
	process.on('SIGINT', shutdown);

	// Handle uncaught errors
	process.on('uncaughtException', (err) => {
		log(`Uncaught exception: ${err.message}`);
		log(err.stack || '');
		process.exit(1);
	});

	process.on('unhandledRejection', (reason) => {
		log(`Unhandled rejection: ${reason}`);
		process.exit(1);
	});

	// Keep process alive
	log('Gateway client started, waiting for tool calls...');
}

main();
