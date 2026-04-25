#!/usr/bin/env node
/**
 * Gateway daemon entry point. Runs as a background process via launchd/systemd
 * and serves the local HTTP + WebSocket API on the configured port.
 */

import {writeFileSync, existsSync, statSync, unlinkSync} from 'node:fs';
import {getPreferences, updatePreferences} from '../config/preferences.js';
import {startServer} from './api/server.js';
import {ptyManager} from './pty/manager.js';
import {gatewayLog, GATEWAY_LOG_FILE} from './gateway-log.js';

const LOG_MAX_AGE_DAYS = 3;

function clearOldLogs(): void {
	try {
		if (!existsSync(GATEWAY_LOG_FILE)) return;
		const stats = statSync(GATEWAY_LOG_FILE);
		const ageMs = Date.now() - stats.mtime.getTime();
		const maxAgeMs = LOG_MAX_AGE_DAYS * 24 * 60 * 60 * 1000;
		if (ageMs > maxAgeMs) {
			unlinkSync(GATEWAY_LOG_FILE);
			writeFileSync(
				GATEWAY_LOG_FILE,
				`[${new Date().toISOString()}] Log file cleared (was older than ${LOG_MAX_AGE_DAYS} days)\n`,
			);
		}
	} catch {
		/* ignore rotation errors */
	}
}

// Local alias so the existing `log(...)` call sites keep working. The shared
// module owns the file + append semantics.
const log = gatewayLog;

async function main() {
	clearOldLogs();
	log('Starting gateway daemon...');

	const prefs = getPreferences();
	const gw = prefs.gateway;

	const port = Number(
		process.env.COREBRAIN_GATEWAY_HTTP_PORT ?? gw?.httpPort ?? 7787,
	);
	log(`Port: ${port}`);
	log(`Gateway id: ${gw?.id ?? '(unregistered)'}`);
	log(`Gateway name: ${gw?.name ?? '(unnamed)'}`);

	if (!gw?.securityKeyHash) {
		log(
			'WARNING: No securityKey configured. Run `corebrain gateway register` first — every request will return 401 until a key is set.',
		);
	}

	try {
		await startServer({port, log});
	} catch (err) {
		log(`Failed to start HTTP server: ${(err as Error).message}`);
		process.exit(1);
	}

	const shutdown = (signal: string) => {
		log(`Shutting down (${signal})...`);
		ptyManager.killAll();
		process.exit(0);
	};

	process.on('SIGTERM', () => shutdown('SIGTERM'));
	process.on('SIGINT', () => shutdown('SIGINT'));

	process.on('uncaughtException', (err) => {
		log(`Uncaught exception: ${err.message}`);
		log(err.stack || '');
	});

	process.on('unhandledRejection', (reason) => {
		log(`Unhandled rejection: ${reason instanceof Error ? reason.message : String(reason)}`);
	});

	updatePreferences({
		gateway: {
			...(prefs.gateway ?? {pid: 0, startedAt: 0}),
			pid: process.pid,
			startedAt: Date.now(),
			httpPort: port,
		},
	});

	log(`Gateway daemon ready on :${port}`);
}

main();
