/**
 * Coding session watcher.
 *
 * Polls each running coding session's transcript every few seconds and
 * pushes a `turn_ended` event back to the webapp the moment the
 * assistant finishes responding to a user turn (i.e. the session's
 * computed status flips from `working` → `idle`). The webapp uses that
 * signal to enqueue a Task title/description update job — no client
 * polling required.
 *
 * Auth: we POST with the user's API key (`config.auth.apiKey`) and
 * identify the gateway by its `httpBaseUrl`, since the CLI doesn't know
 * its own webapp-side ID.
 */

import {getConfig} from '@/config/index';
import {getPreferences} from '@/config/preferences';
import {gatewayLog} from '@/server/gateway-log';
import {
	readAgentSessionTurns,
	type ConversationTurn,
} from '@/utils/coding-agents';
import {isProcessRunning} from '@/utils/coding-runner';

const POLL_INTERVAL_MS = 3_000;

type WatchedStatus = 'initializing' | 'working' | 'idle' | 'ended';

interface WatchedSession {
	sessionId: string;
	agentName: string;
	dir: string;
	timer: NodeJS.Timeout | null;
	lastStatus: WatchedStatus;
}

const watched = new Map<string, WatchedSession>();

export function startCodingSessionWatcher(args: {
	sessionId: string;
	agentName: string;
	dir: string;
}): void {
	if (watched.has(args.sessionId)) return;
	const entry: WatchedSession = {
		sessionId: args.sessionId,
		agentName: args.agentName,
		dir: args.dir,
		timer: null,
		lastStatus: 'initializing',
	};
	watched.set(args.sessionId, entry);
	scheduleNext(entry);
}

export function stopCodingSessionWatcher(sessionId: string): void {
	const entry = watched.get(sessionId);
	if (!entry) return;
	if (entry.timer) clearTimeout(entry.timer);
	watched.delete(sessionId);
}

function scheduleNext(entry: WatchedSession): void {
	entry.timer = setTimeout(() => {
		tick(entry).catch(err => {
			gatewayLog(
				`coding-watch: tick error sessionId=${entry.sessionId} err=${
					err instanceof Error ? err.message : String(err)
				}`,
			);
		});
	}, POLL_INTERVAL_MS);
}

async function tick(entry: WatchedSession): Promise<void> {
	if (!watched.has(entry.sessionId)) return;

	const running = isProcessRunning(entry.sessionId);
	const {turns, fileExists} = await readAgentSessionTurns(
		entry.agentName,
		entry.dir,
		entry.sessionId,
		{tail: true, lines: 50},
	);

	const status: WatchedStatus = deriveStatus({running, fileExists, turns});

	// working → idle = assistant just finished responding. This is the edge
	// we report. We also report initializing → idle, which happens when a
	// brand-new session lands its first assistant reply faster than our
	// poll could see the working state.
	if (status === 'idle' && entry.lastStatus !== 'idle') {
		postTurnEnded(entry.sessionId).catch(err => {
			gatewayLog(
				`coding-watch: post failed sessionId=${entry.sessionId} err=${
					err instanceof Error ? err.message : String(err)
				}`,
			);
		});
	}

	entry.lastStatus = status;

	if (status === 'ended') {
		// Stop watching when the PTY is gone. Don't auto-restart — the
		// caller registers a fresh watcher on resume.
		stopCodingSessionWatcher(entry.sessionId);
		return;
	}

	scheduleNext(entry);
}

function deriveStatus(args: {
	running: boolean;
	fileExists: boolean;
	turns: ConversationTurn[];
}): WatchedStatus {
	if (!args.running) return 'ended';
	if (!args.fileExists) return 'initializing';
	const last = args.turns.length > 0 ? args.turns[args.turns.length - 1] : null;
	if (!last) return 'initializing';
	if (last.role === 'user') return 'working';
	if (last.role === 'assistant') return 'idle';
	return 'initializing';
}

async function postTurnEnded(sessionId: string): Promise<void> {
	const config = getConfig();
	const url = config.auth?.url;
	const apiKey = config.auth?.apiKey;
	if (!url || !apiKey) {
		// Gateway never logged in — silently skip. Headless gateways without
		// a configured webapp are still valid: they just don't get the
		// task-description update side-effect.
		return;
	}

	const prefs = getPreferences();
	const baseUrl = prefs.gateway?.httpBaseUrl;
	if (!baseUrl) return;

	const endpoint = `${url.replace(/\/+$/, '')}/api/v1/internal/coding-events`;
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), 8_000);
	try {
		const res = await fetch(endpoint, {
			method: 'POST',
			headers: {
				'content-type': 'application/json',
				authorization: `Bearer ${apiKey}`,
			},
			body: JSON.stringify({
				kind: 'turn_ended',
				baseUrl: baseUrl.replace(/\/+$/, ''),
				sessionId,
				at: new Date().toISOString(),
			}),
			signal: controller.signal,
		});
		if (!res.ok) {
			gatewayLog(
				`coding-watch: post turn_ended status=${res.status} sessionId=${sessionId}`,
			);
		}
	} finally {
		clearTimeout(timeout);
	}
}
