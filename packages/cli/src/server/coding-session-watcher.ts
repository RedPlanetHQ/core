/**
 * Coding session watcher.
 *
 * Pushes a `turn_ended` event back to the webapp the moment the
 * assistant finishes responding to a user turn (i.e. the session's
 * computed status flips from `working` → `idle`). The webapp uses that
 * signal to enqueue a Task title/description update job — no client
 * polling required.
 *
 * Triggering strategy:
 *   - Primary: `fs.watch(dirname(transcript))` filtered by basename.
 *     Watching the directory (not the file) means we don't bet on
 *     append-in-place writes and we pick up the transcript even if
 *     the agent hasn't created it yet at the time we start.
 *   - Backstop: a low-frequency mtime poll every 5s. `fs.watch`
 *     silently no-ops on some filesystems (NFS, certain Docker bind
 *     mounts); the poll guarantees we still detect change.
 *   - Retry-on-working: if a tick reads the transcript mid-line and
 *     `readJsonlLines` silently drops the half-written final line, the
 *     status stays `working`. We schedule one short follow-up tick to
 *     catch the completing write.
 *   - `pty.onExit` is a separate signal: fires a final tick (fire and
 *     forget — the read path is async) before tearing down so the last
 *     `turn_ended` isn't lost.
 *
 * Lifetime:
 *   Sliding 10-min idle cap, reset on any sign of activity (watch
 *   event, backstop mtime change, or a tick that sees `working`).
 *   Reaps abandoned sessions without cutting off active ones.
 *
 * Auth: we POST with the user's API key (`config.auth.apiKey`). The
 * webapp resolves the session from `(workspaceId, externalSessionId)`
 * — workspaceId comes from the API key, and externalSessionId is a UUID
 * the coding agent generated, so no gateway-identity field is needed.
 */

import {watch as fsWatch, statSync, type FSWatcher} from 'node:fs';
import {basename, dirname} from 'node:path';

import {getConfig} from '@/config/index';
import {gatewayLog} from '@/server/gateway-log';
import {ptyManager} from '@/server/pty/manager';
import {
	getAgentReader,
	readAgentSessionTurns,
	type ConversationTurn,
} from '@/utils/coding-agents';
import {isProcessRunning} from '@/utils/coding-runner';

/** Coalesce fs-watch double-fires (FSEvents on macOS / inotify on
 * Linux can emit multiple events per logical write). */
const WATCH_DEBOUNCE_MS = 200;

/** Backstop poll cadence — covers filesystems where `fs.watch` is a
 * silent no-op. Cheap stat() call. */
const MTIME_POLL_MS = 5_000;

/** Retry delay after a tick that still saw `working`. The agent may
 * have flushed the line by then, or fs.watch will fire on the
 * completing write. */
const WORKING_RETRY_MS = 1_000;

/** Sliding idle cap — resets on any sign of activity. */
const IDLE_CAP_MS = 10 * 60 * 1000;

type WatchedStatus = 'initializing' | 'working' | 'idle' | 'ended';

interface WatchedSession {
	sessionId: string;
	agentName: string;
	dir: string;
	filePath: string;
	lastStatus: WatchedStatus;
	lastMtimeMs: number;
	debounceTimer: NodeJS.Timeout | null;
	workingRetryTimer: NodeJS.Timeout | null;
	idleCapTimer: NodeJS.Timeout | null;
	mtimePoll: NodeJS.Timeout | null;
	watcher: FSWatcher | null;
	detachPty: (() => void) | null;
	stopping: boolean;
}

const watched = new Map<string, WatchedSession>();

export function startCodingSessionWatcher(args: {
	sessionId: string;
	agentName: string;
	dir: string;
}): void {
	if (watched.has(args.sessionId)) return;

	const reader = getAgentReader(args.agentName);
	if (!reader) {
		gatewayLog(
			`coding-watch: no reader for agent="${args.agentName}", skipping`,
		);
		return;
	}

	// Resolve the file path once — for codex this is an O(history) scan.
	// If we can't resolve it yet, the agent may not have written its
	// transcript; abort and let the next call (e.g. on resume) try again.
	const filePath = reader.getSessionFilePath(args.dir, args.sessionId);
	if (!filePath) {
		gatewayLog(
			`coding-watch: no transcript path for sessionId=${args.sessionId}, skipping`,
		);
		return;
	}

	const entry: WatchedSession = {
		sessionId: args.sessionId,
		agentName: args.agentName,
		dir: args.dir,
		filePath,
		lastStatus: 'initializing',
		lastMtimeMs: safeMtime(filePath),
		debounceTimer: null,
		workingRetryTimer: null,
		idleCapTimer: null,
		mtimePoll: null,
		watcher: null,
		detachPty: null,
		stopping: false,
	};
	watched.set(args.sessionId, entry);

	gatewayLog(
		`coding-watch: started sessionId=${args.sessionId} agent=${args.agentName} file=${filePath}`,
	);

	// Watch the parent directory and filter by basename. Watching the
	// dir (not the file) handles: file doesn't exist yet, agent uses
	// temp+rename for atomic writes, file gets replaced.
	const parentDir = dirname(filePath);
	const targetBasename = basename(filePath);
	try {
		entry.watcher = fsWatch(parentDir, {persistent: false}, (event, name) => {
			if (name && name !== targetBasename) return;
			gatewayLog(
				`coding-watch: fs event sessionId=${args.sessionId} event=${event} name=${name ?? '(null)'}`,
			);
			scheduleTick(entry, 'watch');
		});
		gatewayLog(
			`coding-watch: fs.watch attached sessionId=${args.sessionId} dir=${parentDir} basename=${targetBasename}`,
		);
	} catch (err) {
		gatewayLog(
			`coding-watch: fs.watch failed for ${parentDir} err=${
				err instanceof Error ? err.message : String(err)
			}`,
		);
		// Continue without the primary trigger — backstop poll will
		// carry the load.
	}

	// Backstop mtime poll — picks up changes on filesystems where
	// fs.watch is a silent no-op (NFS, some Docker bind mounts).
	entry.mtimePoll = setInterval(() => {
		const mtime = safeMtime(entry.filePath);
		if (mtime > entry.lastMtimeMs) {
			gatewayLog(
				`coding-watch: mtime change sessionId=${args.sessionId} prev=${entry.lastMtimeMs} cur=${mtime}`,
			);
			scheduleTick(entry, 'mtime');
		}
	}, MTIME_POLL_MS);
	entry.mtimePoll.unref?.();

	// pty.onExit → fire-and-forget a final tick so the last turn_ended
	// is sent before we tear down. `flushAndStop` flips the stopping
	// flag, kicks off the tick, and the tick body finishes after the
	// entry is removed from `watched` (it checks `stopping` instead).
	const attached = ptyManager.attach(
		args.sessionId,
		() => {
			// We don't use PTY data as a trigger any more — the
			// transcript file is the ground truth. The no-op handler
			// is required by attach()'s signature.
		},
		() => {
			flushAndStop(args.sessionId);
		},
	);
	entry.detachPty = attached ? attached.detach : null;

	// Sliding idle cap.
	armIdleCap(entry);

	// Initial tick — picks up whatever already exists in the
	// transcript (the file may have been written before we attached).
	scheduleTick(entry, 'initial');
}

export function stopCodingSessionWatcher(sessionId: string): void {
	const entry = watched.get(sessionId);
	if (!entry) return;
	entry.stopping = true;
	if (entry.debounceTimer) clearTimeout(entry.debounceTimer);
	if (entry.workingRetryTimer) clearTimeout(entry.workingRetryTimer);
	if (entry.idleCapTimer) clearTimeout(entry.idleCapTimer);
	if (entry.mtimePoll) clearInterval(entry.mtimePoll);
	if (entry.watcher) {
		try {
			entry.watcher.close();
		} catch {
			/* ignore */
		}
	}
	if (entry.detachPty) {
		try {
			entry.detachPty();
		} catch {
			/* ignore */
		}
	}
	watched.delete(sessionId);
}

/**
 * pty.onExit path — flush one final tick before stopping so the last
 * `turn_ended` isn't dropped. `tick` is async and the exit subscriber
 * can't await without blocking sibling subscribers, so we kick off
 * runTick and return immediately. The tick checks `entry.stopping`
 * to allow the final read to complete after the entry is removed.
 */
function flushAndStop(sessionId: string): void {
	const entry = watched.get(sessionId);
	if (!entry) return;
	gatewayLog(`coding-watch: pty exit sessionId=${sessionId}, flushing final tick`);
	if (entry.debounceTimer) {
		clearTimeout(entry.debounceTimer);
		entry.debounceTimer = null;
	}
	// Run the final tick before tearing down the watch handles. The
	// promise resolves on its own; we don't block the exit handler.
	runTick(entry, 'exit');
	stopCodingSessionWatcher(sessionId);
}

function scheduleTick(entry: WatchedSession, source: string): void {
	if (entry.stopping) return;
	if (entry.debounceTimer) clearTimeout(entry.debounceTimer);
	entry.debounceTimer = setTimeout(() => {
		entry.debounceTimer = null;
		runTick(entry, source);
	}, WATCH_DEBOUNCE_MS);
	entry.debounceTimer.unref?.();
}

function runTick(entry: WatchedSession, source: string): void {
	tick(entry, source).catch(err => {
		gatewayLog(
			`coding-watch: tick error sessionId=${entry.sessionId} src=${source} err=${
				err instanceof Error ? err.message : String(err)
			}`,
		);
	});
}

async function tick(entry: WatchedSession, source: string): Promise<void> {
	// Allow ticks for entries that are stopping (we want the exit-flush
	// path to finish), but bail if the entry has been fully removed
	// AND wasn't stopping at the time we were enqueued.
	if (!watched.has(entry.sessionId) && !entry.stopping) return;

	const running = isProcessRunning(entry.sessionId);
	const {turns, fileExists} = await readAgentSessionTurns(
		entry.agentName,
		entry.dir,
		entry.sessionId,
		{tail: true, lines: 50},
	);

	// Refresh mtime cursor so the backstop poll doesn't keep
	// re-firing on the same change.
	entry.lastMtimeMs = safeMtime(entry.filePath);

	const status: WatchedStatus = deriveStatus({running, fileExists, turns});

	gatewayLog(
		`coding-watch: tick sessionId=${entry.sessionId} src=${source} status=${status} prev=${entry.lastStatus} turns=${turns.length} running=${running} fileExists=${fileExists}`,
	);

	// working → idle (and initializing → idle) = assistant finished
	// responding. The only edge we care about.
	if (status === 'idle' && entry.lastStatus !== 'idle') {
		gatewayLog(
			`coding-watch: transition ${entry.lastStatus}→idle sessionId=${entry.sessionId}, posting turn_ended`,
		);
		postTurnEnded(entry.sessionId).catch(err => {
			gatewayLog(
				`coding-watch: post failed sessionId=${entry.sessionId} err=${
					err instanceof Error ? err.message : String(err)
				}`,
			);
		});
	}

	entry.lastStatus = status;

	// Sliding cap — any signal of life resets it.
	if (status === 'working' || source === 'watch' || source === 'mtime') {
		armIdleCap(entry);
	}

	// Working after a watch event almost certainly means we caught the
	// agent mid-write and the JSONL parser dropped the half-line.
	// Schedule a single short retry; fs.watch will likely fire again
	// on its own too, in which case scheduleTick coalesces.
	if (status === 'working' && !entry.stopping) {
		if (entry.workingRetryTimer) clearTimeout(entry.workingRetryTimer);
		entry.workingRetryTimer = setTimeout(() => {
			entry.workingRetryTimer = null;
			runTick(entry, 'retry');
		}, WORKING_RETRY_MS);
		entry.workingRetryTimer.unref?.();
	}

	if (status === 'ended' && !entry.stopping) {
		stopCodingSessionWatcher(entry.sessionId);
	}
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

function armIdleCap(entry: WatchedSession): void {
	if (entry.idleCapTimer) clearTimeout(entry.idleCapTimer);
	entry.idleCapTimer = setTimeout(() => {
		gatewayLog(
			`coding-watch: idle cap reached, stopping sessionId=${entry.sessionId}`,
		);
		stopCodingSessionWatcher(entry.sessionId);
	}, IDLE_CAP_MS);
	entry.idleCapTimer.unref?.();
}

function safeMtime(filePath: string): number {
	try {
		return statSync(filePath).mtimeMs;
	} catch {
		return 0;
	}
}

async function postTurnEnded(sessionId: string): Promise<void> {
	const config = getConfig();
	const url = config.auth?.url;
	const apiKey = config.auth?.apiKey;
	if (!url || !apiKey) {
		// Gateway never logged in — silently skip. Headless gateways
		// without a configured webapp are still valid: they just don't
		// get the task-description update side-effect.
		gatewayLog(
			`coding-watch: skip post sessionId=${sessionId} reason=no_auth url=${url ?? '(missing)'} apiKey=${apiKey ? '(set)' : '(missing)'}`,
		);
		return;
	}

	const endpoint = `${url.replace(/\/+$/, '')}/api/v1/internal/coding-events`;
	gatewayLog(
		`coding-watch: posting turn_ended sessionId=${sessionId} endpoint=${endpoint}`,
	);
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
				sessionId,
				at: new Date().toISOString(),
			}),
			signal: controller.signal,
		});
		const bodyText = await res.text().catch(() => '');
		if (!res.ok) {
			gatewayLog(
				`coding-watch: post turn_ended FAILED status=${res.status} sessionId=${sessionId} body=${bodyText.slice(0, 200)}`,
			);
		} else {
			gatewayLog(
				`coding-watch: post turn_ended OK status=${res.status} sessionId=${sessionId}`,
			);
		}
	} catch (err) {
		gatewayLog(
			`coding-watch: post turn_ended threw sessionId=${sessionId} err=${
				err instanceof Error ? err.message : String(err)
			}`,
		);
	} finally {
		clearTimeout(timeout);
	}
}
