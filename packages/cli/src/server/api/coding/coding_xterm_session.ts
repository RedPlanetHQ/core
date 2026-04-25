import type {FastifyPluginAsync} from 'fastify';
import {ptyManager} from '@/server/pty/manager';

/**
 * WebSocket endpoint that attaches to a running coding session's PTY.
 *
 *   GET /api/coding/coding_xterm_session?session_id=<id>
 *
 * Behavior on connect:
 *   - Replays the scrollback buffer (≤256 KB).
 *   - Streams new PTY output bytes as raw WS text frames.
 *   - Forwards incoming WS messages to the PTY — plain text is written to stdin;
 *     JSON `{"kind":"input","data":"..."}` writes `data`; JSON
 *     `{"kind":"resize","cols":N,"rows":M}` resizes the PTY.
 *   - If the PTY has already exited, replays the buffer then closes.
 *   - If no session exists, closes the socket with code 4404.
 */
export const xtermSessionRoute: FastifyPluginAsync = async (app) => {
	app.get<{Querystring: {session_id?: string}}>(
		'/coding_xterm_session',
		{websocket: true},
		(socket, req) => {
			const sessionId = (req.query as {session_id?: string} | undefined)?.session_id;
			if (!sessionId) {
				socket.close(4400, 'session_id query param required');
				return;
			}

			const attach = ptyManager.attach(
				sessionId,
				(data) => {
					if (socket.readyState === socket.OPEN) {
						socket.send(data);
					}
				},
				({exitCode, signal}) => {
					if (socket.readyState === socket.OPEN) {
						socket.send(JSON.stringify({kind: 'exit', exitCode, signal}));
						socket.close(1000, `pty exited (${exitCode})`);
					}
				},
			);

			if (!attach) {
				socket.close(4404, `no running session with id "${sessionId}"`);
				return;
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
