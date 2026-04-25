import type {FastifyPluginAsync} from 'fastify';
import {randomUUID} from 'node:crypto';
import {existsSync} from 'node:fs';
import {
	getAgentConfig,
	buildStartArgs,
	buildResumeArgs,
	startAgentProcess,
} from '@/utils/coding-runner';
import {upsertSession, deleteSession} from '@/utils/coding-sessions';
import {listFolders, resolveFolderForPath} from '@/config/folders';
import {ptyManager} from '@/server/pty/manager';
import {findLatestCodexSession} from '@/utils/coding-agents';
import {gatewayLog} from '@/server/gateway-log';

/**
 * Spawn (or resume) a coding agent's interactive TUI so the xterm WS has a
 * PTY to attach to. This is a webapp-only primitive — LLM callers use
 * `coding_ask` which requires a prompt.
 *
 *   POST /api/coding/spawn
 *   body: { agent, dir, sessionId? }
 *   → 200 { ok: true, sessionId, pid, status }
 *
 * Semantics (mirrors the old Tauri PTY reconnect logic):
 *   - No `sessionId` → new interactive session. A UUID is allocated; for
 *     codex-cli we re-key to the session id codex writes to disk.
 *   - `sessionId` present:
 *       • PTY is live for that id   → noop; xterm attach will reconnect.
 *       • PTY exited / not present  → spawn fresh using `resumeArgs`.
 *
 * `status` is one of `"new" | "reconnect" | "resumed"` so the caller knows
 * what happened.
 */
export const codingSpawnRoute: FastifyPluginAsync = async (app) => {
	app.post<{
		Body: {agent?: string; dir?: string; sessionId?: string};
	}>('/spawn', async (req, reply) => {
		const body = (req.body ?? {}) as {
			agent?: string;
			dir?: string;
			sessionId?: string;
		};

		if (!body.agent || !body.dir) {
			reply.code(400);
			return {ok: false, error: 'agent and dir are required'};
		}
		if (!existsSync(body.dir)) {
			reply.code(400);
			return {ok: false, error: `dir "${body.dir}" does not exist`};
		}
		if (listFolders().length > 0) {
			const folder = resolveFolderForPath(body.dir, 'coding');
			if (!folder) {
				reply.code(403);
				return {
					ok: false,
					error: `dir "${body.dir}" is not inside a coding-scoped folder`,
				};
			}
		}
		const config = getAgentConfig(body.agent);
		if (!config) {
			reply.code(400);
			return {
				ok: false,
				error: `agent "${body.agent}" is not configured on this gateway`,
			};
		}

		const isResume = Boolean(body.sessionId);

		// Reconnect short-circuit: if the PTY is live for this id, don't respawn
		// — xterm `attach` will replay the scrollback and keep streaming. Stale
		// (exited) handles at the same id are dropped by `ptyManager.spawn`.
		if (isResume && ptyManager.isRunning(body.sessionId!)) {
			return {
				ok: true,
				sessionId: body.sessionId,
				pid: ptyManager.getPid(body.sessionId!),
				status: 'reconnect',
			};
		}

		let sessionId = body.sessionId ?? randomUUID();
		const args = isResume
			? buildResumeArgs(config, {sessionId})
			: buildStartArgs(config, {sessionId});

		if (isResume && args.length === 0) {
			reply.code(400);
			return {
				ok: false,
				error: `agent "${body.agent}" has no resumeArgs configured`,
			};
		}

		const startedAt = Date.now();
		upsertSession({sessionId, agent: body.agent, dir: body.dir, startedAt});

		gatewayLog(
			`spawn: agent=${body.agent} dir=${body.dir} sessionId=${sessionId} ${
				isResume ? 'resume' : 'new'
			}`,
		);
		const {pid, error} = startAgentProcess(
			sessionId,
			config,
			args,
			body.dir,
			gatewayLog,
		);
		if (error) {
			deleteSession(sessionId);
			gatewayLog(`spawn FAILED: ${error}`);
			reply.code(500);
			return {ok: false, error: `failed to spawn: ${error}`};
		}
		upsertSession({
			sessionId,
			agent: body.agent,
			dir: body.dir,
			pid,
			startedAt,
		});

		// codex-cli writes a session file named with its own UUID. Re-key our
		// record so downstream lookups (read_session, resume) find the right file.
		if (!isResume && body.agent === 'codex-cli') {
			const found = await findLatestCodexSession(body.dir, startedAt);
			if (found && found.sessionId !== sessionId) {
				deleteSession(sessionId);
				sessionId = found.sessionId;
				upsertSession({
					sessionId,
					agent: body.agent,
					dir: body.dir,
					pid,
					startedAt,
				});
			}
		}

		return {
			ok: true,
			sessionId,
			pid,
			status: isResume ? 'resumed' : 'new',
		};
	});
};
