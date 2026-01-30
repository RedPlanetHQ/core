#!/usr/bin/env node
/**
 * Gateway server entry point - runs as a detached background process
 */

import {startGatewayServer} from './gateway.js';
import {writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {homedir} from 'node:os';

const DEFAULT_PORT = 3456;
const LOG_DIR = join(homedir(), '.corebrain', 'logs');

function log(message: string) {
	const timestamp = new Date().toISOString();
	const logMessage = `[${timestamp}] ${message}\n`;

	try {
		const logFile = join(LOG_DIR, `gateway-${process.pid}.log`);
		writeFileSync(logFile, logMessage, {flag: 'a'});
	} catch (err) {
		// If logging fails, at least try stderr
		process.stderr.write(logMessage);
	}
}

async function main() {
	const port = process.argv[2] ? parseInt(process.argv[2], 10) : DEFAULT_PORT;

	if (isNaN(port) || port < 1024 || port > 65535) {
		log(`Invalid port: ${process.argv[2]}. Using default: ${DEFAULT_PORT}`);
	}

	log(`Starting gateway server on port ${port}...`);

	try {
		const {server} = await startGatewayServer(port);

		log(`Gateway server successfully started on port ${port}`);
		log(`PID: ${process.pid}`);

		// Handle graceful shutdown
		process.on('SIGTERM', () => {
			log('Received SIGTERM, shutting down gracefully...');
			server.close(() => {
				log('Server closed');
				process.exit(0);
			});
		});

		process.on('SIGINT', () => {
			log('Received SIGINT, shutting down gracefully...');
			server.close(() => {
				log('Server closed');
				process.exit(0);
			});
		});

		// Handle uncaught errors
		process.on('uncaughtException', err => {
			log(`Uncaught exception: ${err.message}`);
			log(err.stack || '');
			process.exit(1);
		});

		process.on('unhandledRejection', reason => {
			log(`Unhandled rejection: ${reason}`);
			process.exit(1);
		});
	} catch (err) {
		log(
			`Failed to start gateway server: ${
				err instanceof Error ? err.message : String(err)
			}`,
		);
		if (err instanceof Error && err.stack) {
			log(err.stack);
		}
		process.exit(1);
	}
}

main();
