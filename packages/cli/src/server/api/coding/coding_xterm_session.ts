import type {FastifyPluginAsync} from 'fastify';
import {ptyManager} from '@/server/pty/manager';
import {upsertSession} from '@/utils/coding-sessions';
import {scanAllSessions} from '@/utils/coding-agents';
import {
	getAgentConfig,
	buildResumeArgs,
	startAgentProcess,
} from '@/utils/coding-runner';
import {gatewayLog} from '@/server/gateway-log';

/**
 * WebSocket endpoint that attaches to a coding session's PTY, automatically
 * resuming the agent when the PTY no longer exists.
 *
 *   GET /api/coding/coding_xterm_session?session_id=<id>
 *
 * Resume metadata is read from the agent's own on-disk transcripts (claude
 * `.jsonl` / codex session files) — `sessions.json` carries a stale `dir`
 * (the path the user asked for) whereas the transcript records the agent's
 * real `cwd`, which is what `--resume` needs. If the session id isn't found
 * on disk anywhere, we close with 4404 — there's nothing to resume.
 *
 * Behavior on connect (after attach):
 *   - Replays the scrollback buffer (≤256 KB).
 *   - Streams new PTY output bytes as raw WS text frames.
 *   - Forwards incoming WS messages to the PTY — plain text is written to stdin;
 *     JSON `{"kind":"input","data":"..."}` writes `data`; JSON
 *     `{"kind":"resize","cols":N,"rows":M}` resizes the PTY.
 *   - If the PTY has already exited, replays the buffer then closes.
 */

async function resolveSessionMeta(
	sessionId: string,
): Promise<{agent: string; dir: string} | null> {
	try {
		const {sessions} = await scanAllSessions({});
		gatewayLog(
			`xterm resolve: scanned ${sessions.length} sessions for ${sessionId}`,
		);
		const found = sessions.find(s => s.sessionId === sessionId);
		if (!found) {
			gatewayLog(`xterm resolve: session ${sessionId} not in any agent dir`);
			return null;
		}
		gatewayLog(
			`xterm resolve: session ${sessionId} agent=${found.agent} dir=${found.dir}`,
		);
		if (!found.dir || !found.agent) {
			gatewayLog(
				`xterm resolve: incomplete metadata (agent=${found.agent}, dir=${found.dir})`,
			);
			return null;
		}
		return {agent: found.agent, dir: found.dir};
	} catch (err) {
		gatewayLog(
			`xterm resolve: scan failed: ${err instanceof Error ? err.message : String(err)}`,
		);
		return null;
	}
}

function tryRespawn(
	sessionId: string,
	meta: {agent: string; dir: string},
): {ok: true; pid?: number} | {ok: false; reason: string} {
	const config = getAgentConfig(meta.agent);
	if (!config) {
		return {
			ok: false,
			reason: `agent "${meta.agent}" not configured on this gateway`,
		};
	}
	const args = buildResumeArgs(config, {sessionId});
	if (args.length === 0) {
		return {
			ok: false,
			reason: `agent "${meta.agent}" has no resumeArgs configured`,
		};
	}

	const startedAt = Date.now();
	upsertSession({sessionId, agent: meta.agent, dir: meta.dir, startedAt});
	gatewayLog(
		`xterm resume: agent=${meta.agent} dir=${meta.dir} sessionId=${sessionId}`,
	);
	const {pid, error} = startAgentProcess(
		sessionId,
		config,
		args,
		meta.dir,
		gatewayLog,
	);
	if (error) {
		gatewayLog(`xterm resume FAILED: ${error}`);
		return {ok: false, reason: `failed to spawn: ${error}`};
	}
	upsertSession({
		sessionId,
		agent: meta.agent,
		dir: meta.dir,
		pid,
		startedAt,
	});
	return {ok: true, pid};
}

export const xtermSessionRoute: FastifyPluginAsync = async (app) => {
	app.get<{Querystring: {session_id?: string}}>(
		'/coding_xterm_session',
		{websocket: true},
		async (socket, req) => {
			const sessionId = (req.query as {session_id?: string} | undefined)?.session_id;
			if (!sessionId) {
				socket.close(4400, 'session_id query param required');
				return;
			}

			const onData = (data: string) => {
				if (socket.readyState === socket.OPEN) {
					socket.send(data);
				}
			};
			const onExit = ({
				exitCode,
				signal,
			}: {
				exitCode: number;
				signal?: number;
			}) => {
				if (socket.readyState === socket.OPEN) {
					socket.send(JSON.stringify({kind: 'exit', exitCode, signal}));
					socket.close(1000, `pty exited (${exitCode})`);
				}
			};

			let attach = ptyManager.attach(sessionId, onData, onExit);

			// Resume only when there's no handle for this id at all. If a handle
			// exists but exited (e.g. user typed `exit` in a shell session), fall
			// through to the standard "replay buffer + emit exit + close" path
			// below — re-spawning a fresh agent over a non-coding PTY would be
			// surprising. `resolveSessionMeta` deliberately scans agent
			// transcripts only, so resume targets coding sessions.
			if (!attach) {
				const meta = await resolveSessionMeta(sessionId);
				if (!meta) {
					socket.close(4404, `no session "${sessionId}" — cannot resume`);
					return;
				}
				const result = tryRespawn(sessionId, meta);
				if (!result.ok) {
					socket.close(4500, result.reason);
					return;
				}
				attach = ptyManager.attach(sessionId, onData, onExit);
				if (!attach) {
					socket.close(4500, 'spawned session but failed to attach');
					return;
				}
			}

			// Replay scrollback buffer
			if (attach.replayed) {
				socket.send(attach.replayed);
			}

			// If it already exited, replay + close
			if (attach.exited) {
				socket.send(
					JSON.stringify({
						kind: 'exit',
						exitCode: attach.exitInfo?.exitCode ?? null,
						signal: attach.exitInfo?.signal ?? null,
					}),
				);
				socket.close(1000, 'pty already exited');
				attach.detach();
				return;
			}

			socket.on('message', (raw: Buffer | string) => {
				const msg = typeof raw === 'string' ? raw : raw.toString('utf8');
				// Try JSON envelope first
				try {
					const parsed = JSON.parse(msg);
					if (parsed && typeof parsed === 'object') {
						if (parsed.kind === 'input' && typeof parsed.data === 'string') {
							ptyManager.write(sessionId, parsed.data);
							return;
						}
						if (parsed.kind === 'resize' && typeof parsed.cols === 'number' && typeof parsed.rows === 'number') {
							ptyManager.resize(sessionId, parsed.cols, parsed.rows);
							return;
						}
					}
				} catch {
					/* not JSON — fall through to raw */
				}
				// Fallback: write raw bytes (CLI xterm clients send keystrokes directly)
				ptyManager.write(sessionId, msg);
			});

			socket.on('close', () => {
				attach.detach();
			});
		},
	);
};
