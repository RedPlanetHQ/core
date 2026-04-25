import type {FastifyPluginAsync} from 'fastify';
import WebSocket from 'ws';
import {getSessionCdpInfo} from '@/utils/browser-manager';
import {gatewayLog} from '@/server/gateway-log';

/**
 * WebSocket proxy that pipes Chrome DevTools Protocol traffic between the
 * webapp and a running Playwright-launched Chromium.
 *
 *   GET /api/browser/cdp/:session
 *
 * Looks up the session's `--remote-debugging-port` endpoint (captured at
 * launch time in `browser-manager.ts`), opens a client WS to the local
 * Chromium, and pipes frames in both directions. The exposed endpoint is
 * the *browser-level* CDP — the webapp viewer issues `Target.getTargets`
 * and `Target.attachToTarget` to talk to a specific page.
 *
 * Closes with `4404` if the session isn't running. Closes with `4502` if
 * the upstream Chromium WS handshake fails.
 */
export const browserCdpRoute: FastifyPluginAsync = async app => {
	app.get<{Params: {session: string}}>(
		'/cdp/:session',
		{websocket: true},
		(client, req) => {
			const sessionName = (req.params as {session?: string} | undefined)?.session;
			if (!sessionName) {
				client.close(4400, 'session is required');
				return;
			}
			const info = getSessionCdpInfo(sessionName);
			if (!info) {
				client.close(
					4404,
					`browser session "${sessionName}" is not running`,
				);
				return;
			}

			gatewayLog(
				`browser cdp proxy: session=${sessionName} → ${info.wsEndpoint}`,
			);

			const upstream = new WebSocket(info.wsEndpoint, {
				perMessageDeflate: false,
			});

			// 1005/1006/1015 etc. are reserved "received-only" codes — passing them
			// to ws.close() throws. Forward only sendable codes; fall back to 1000.
			const sanitizeCode = (code: number): number =>
				code === 1000 || (code >= 3000 && code <= 4999) ? code : 1000;

			const closeBoth = (code = 1000, reason = '') => {
				const safe = sanitizeCode(code);
				try {
					if (client.readyState === client.OPEN) client.close(safe, reason);
				} catch {
					/* already closing */
				}
				try {
					if (upstream.readyState === upstream.OPEN) upstream.close(safe, reason);
				} catch {
					/* already closing */
				}
			};

			// CDP frames are JSON text — `ws` delivers them as Buffer by default,
			// and `send(buffer)` would re-emit them as a binary frame, which
			// Chromium rejects (it closes the socket on a binary frame against
			// a text protocol). Normalize to UTF-8 strings before forwarding so
			// the relay always emits text frames in both directions.
			const toText = (data: unknown): string => {
				if (typeof data === 'string') return data;
				if (Buffer.isBuffer(data)) return data.toString('utf8');
				if (Array.isArray(data))
					return Buffer.concat(data as Buffer[]).toString('utf8');
				if (data instanceof ArrayBuffer)
					return Buffer.from(data).toString('utf8');
				return String(data);
			};

			// Fastify accepts the client WS upgrade before this handler runs, so
			// the browser may have already sent its first CDP frames (e.g.
			// `Target.setDiscoverTargets`) by the time we get here. Buffer them
			// until upstream is open so nothing is dropped.
			const queue: string[] = [];
			let upstreamReady = false;
			let clientFrames = 0;
			let upstreamFrames = 0;

			const previewFrame = (frame: string): string => {
				try {
					const parsed = JSON.parse(frame);
					return parsed.method ?? `id=${parsed.id ?? '?'}`;
				} catch {
					return frame.slice(0, 60);
				}
			};

			client.on('message', data => {
				const frame = toText(data);
				clientFrames += 1;
				if (clientFrames <= 2) {
					gatewayLog(
						`cdp client→upstream [${clientFrames}]: ${previewFrame(frame)} (queued=${!upstreamReady})`,
					);
				}
				if (upstreamReady && upstream.readyState === upstream.OPEN) {
					upstream.send(frame);
				} else {
					queue.push(frame);
				}
			});

			upstream.on('open', () => {
				upstreamReady = true;
				gatewayLog(
					`cdp upstream open, flushing ${queue.length} queued frame(s)`,
				);
				for (const frame of queue) {
					if (upstream.readyState === upstream.OPEN) upstream.send(frame);
				}
				queue.length = 0;
				upstream.on('message', data => {
					const frame = toText(data);
					upstreamFrames += 1;
					if (upstreamFrames <= 2) {
						gatewayLog(
							`cdp upstream→client [${upstreamFrames}]: ${previewFrame(frame)}`,
						);
					}
					if (client.readyState === client.OPEN) client.send(frame);
				});
			});

			upstream.on('close', (code, reason) => {
				gatewayLog(
					`cdp upstream closed: code=${code} reason=${reason?.toString() ?? ''}`,
				);
				closeBoth(code, reason?.toString());
			});
			client.on('close', (code, reason) => {
				gatewayLog(
					`cdp client closed: code=${code} reason=${reason?.toString() ?? ''}`,
				);
				closeBoth(code, reason?.toString());
			});

			upstream.on('error', err => {
				gatewayLog(`browser cdp upstream error: ${err.message}`);
				closeBoth(4502, 'upstream cdp error');
			});
			client.on('error', err => {
				gatewayLog(
					`browser cdp client error: ${err instanceof Error ? err.message : String(err)}`,
				);
				closeBoth(1011, 'client error');
			});
		},
	);
};
