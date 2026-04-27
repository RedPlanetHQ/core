import type {FastifyPluginAsync} from 'fastify';
import {randomUUID} from 'node:crypto';
import {homedir} from 'node:os';
import {existsSync} from 'node:fs';
import {ptyManager} from '@/server/pty/manager';
import {gatewayLog} from '@/server/gateway-log';

/**
 * General-purpose shell PTY for the webapp's per-gateway Terminal tab.
 *
 *   POST /api/shell/spawn
 *   body: { cwd?: string, fresh?: boolean }
 *   → 200 { ok: true, sessionId, pid, resumed }
 *
 * Singleton model: the gateway tracks one active shell session at a time.
 * Without `fresh`, calls return the existing session if it's still alive
 * (the browser then replays scrollback over the xterm WS — see
 * `ptyManager.attach`). With `fresh: true`, the previous session is killed
 * and a new one spawned. `resumed` distinguishes the two outcomes for the UI.
 *
 * Auth is handled by the global gateway auth hook (security key), so anyone
 * able to hit this can already exec arbitrary tools — no extra guardrails.
 */
let currentShellSessionId: string | null = null;

export const shellRoutes: FastifyPluginAsync = async (app) => {
	app.post<{Body: {cwd?: string; fresh?: boolean}}>(
		'/spawn',
		async (req, reply) => {
			const body = (req.body ?? {}) as {cwd?: string; fresh?: boolean};

			// Resume path: an existing session is still running and the caller
			// didn't ask for a fresh one. Skip the spawn.
			if (
				!body.fresh &&
				currentShellSessionId &&
				ptyManager.isRunning(currentShellSessionId)
			) {
				const pid = ptyManager.getPid(currentShellSessionId) ?? 0;
				return {
					ok: true,
					sessionId: currentShellSessionId,
					pid,
					resumed: true,
				};
			}

			// Either no session yet, the previous one exited, or `fresh` was set.
			// Kill any lingering session first so we don't leak PTYs.
			if (currentShellSessionId) {
				ptyManager.kill(currentShellSessionId);
				currentShellSessionId = null;
			}

			// Resolve a usable shell. SHELL → /bin/zsh → /bin/bash → /bin/sh.
			const candidates = [
				process.env.SHELL,
				'/bin/zsh',
				'/bin/bash',
				'/bin/sh',
			].filter((s): s is string => Boolean(s && existsSync(s)));
			const shell = candidates[0];
			if (!shell) {
				reply.code(500);
				return {ok: false, error: 'no usable shell on PATH'};
			}

			const cwd =
				body.cwd && existsSync(body.cwd)
					? body.cwd
					: process.env.COREBRAIN_DEFAULT_WORKSPACE &&
						  existsSync(process.env.COREBRAIN_DEFAULT_WORKSPACE)
						? process.env.COREBRAIN_DEFAULT_WORKSPACE
						: homedir();

			const sessionId = randomUUID();
			gatewayLog(
				`shell spawn: shell=${shell} cwd=${cwd} sessionId=${sessionId}`,
			);

			try {
				const {pid} = ptyManager.spawn({
					sessionId,
					command: shell,
					args: ['-il'], // login + interactive so PATH/aliases are loaded
					cwd,
					agent: 'shell',
				});
				currentShellSessionId = sessionId;
				return {ok: true, sessionId, pid, resumed: false};
			} catch (err) {
				const msg = err instanceof Error ? err.message : 'spawn failed';
				gatewayLog(`shell spawn FAILED: ${msg}`);
				reply.code(500);
				return {ok: false, error: msg};
			}
		},
	);
};
