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
 *   body: { cwd?: string }
 *   → 200 { ok: true, sessionId, pid }
 *
 * Spawns the user's `$SHELL` (falling back to `/bin/bash` → `/bin/sh`) inside
 * a PTY managed by `ptyManager`. The browser attaches via the existing xterm
 * WS endpoint — no CodingSession involved.
 *
 * Auth is handled by the global gateway auth hook (security key), so anyone
 * able to hit this can already exec arbitrary tools — no extra guardrails.
 */
export const shellRoutes: FastifyPluginAsync = async (app) => {
	app.post<{Body: {cwd?: string}}>('/spawn', async (req, reply) => {
		const body = (req.body ?? {}) as {cwd?: string};

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
			return {ok: true, sessionId, pid};
		} catch (err) {
			const msg = err instanceof Error ? err.message : 'spawn failed';
			gatewayLog(`shell spawn FAILED: ${msg}`);
			reply.code(500);
			return {ok: false, error: msg};
		}
	});
};
