#!/usr/bin/env node
/**
 * Gateway client entry point - runs as a detached background process via launchd/systemd
 * Connects to the remote WebSocket server and handles tool calls
 */

import {writeFileSync, mkdirSync, existsSync} from 'node:fs';
import {join} from 'node:path';
import {homedir, hostname} from 'node:os';
import {GatewayClient} from './gateway-client.js';
import {getConfig} from '../config/index.js';

const LOG_DIR = join(homedir(), '.corebrain', 'logs');

// Ensure log directory exists
if (!existsSync(LOG_DIR)) {
	mkdirSync(LOG_DIR, {recursive: true});
}

function log(message: string) {
	const timestamp = new Date().toISOString();
	const logMessage = `[${timestamp}] ${message}\n`;

	try {
		const logFile = join(LOG_DIR, 'gateway.log');
		writeFileSync(logFile, logMessage, {flag: 'a'});
	} catch {
		// If logging fails, at least try stderr
		process.stderr.write(logMessage);
	}
}

async function main() {
	// Parse command line args: [name] [description]
	const gatewayName = process.argv[2] || `${hostname()}-browser`;
	const gatewayDescription = process.argv[3] || 'Browser automation gateway';

	log(`Starting gateway client...`);
	log(`Name: ${gatewayName}`);
	log(`Description: ${gatewayDescription}`);

	// Load config
	const config = getConfig();

	if (!config.auth?.apiKey || !config.auth?.url) {
		log('ERROR: Not authenticated. Run `corebrain login` first.');
		process.exit(1);
	}

	log(`Connecting to: ${config.auth.url}`);

	// Create gateway client
	const client = new GatewayClient({
		url: config.auth.url,
		apiKey: config.auth.apiKey,
		name: gatewayName,
		description: gatewayDescription,
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
