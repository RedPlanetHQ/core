import type {FastifyPluginAsync} from 'fastify';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {existsSync, mkdirSync, statSync} from 'node:fs';
import {join} from 'node:path';
import {addFolder, listFolders, removeFolder} from '@/config/folders';
import {gatewayLog} from '@/server/gateway-log';

const execFileP = promisify(execFile);

/**
 * Folder management routes (mounted at `/api/folders`).
 *
 *   GET    /api/folders            → manifest mirror, used by webapp settings
 *   POST   /api/folders/local      → register an existing on-disk path
 *   POST   /api/folders/git        → git clone <url> into the workspace, register
 *   DELETE /api/folders/:idOrName  → unregister (does not delete files)
 *
 * Auth is handled upstream (`makeAuthHook`); these handlers assume the caller
 * already passed the gateway's security key.
 */
export const folderRoutes: FastifyPluginAsync = async (app) => {
	// ---- list ----
	app.get('/', async () => ({
		ok: true,
		folders: listFolders(),
	}));

	// ---- register existing local path ----
	app.post<{
		Body: {
			name?: string;
			path?: string;
			scopes?: Array<'files' | 'coding' | 'exec'>;
		};
	}>('/local', async (req, reply) => {
		const body = (req.body ?? {}) as {
			name?: string;
			path?: string;
			scopes?: Array<'files' | 'coding' | 'exec'>;
		};
		if (!body.path) {
			reply.code(400);
			return {ok: false, error: '`path` is required'};
		}

		const scopes =
			body.scopes && body.scopes.length > 0
				? body.scopes
				: (['files', 'coding', 'exec'] as const);

		try {
			const folder = addFolder({
				name: body.name,
				path: body.path,
				scopes: scopes as Array<'files' | 'coding' | 'exec'>,
			});
			gatewayLog(`folder added (local): ${folder.name} → ${folder.path}`);
			return {ok: true, folder};
		} catch (err) {
			reply.code(400);
			return {
				ok: false,
				error: err instanceof Error ? err.message : 'failed to add folder',
			};
		}
	});

	// ---- clone github / git url, register the clone ----
	app.post<{
		Body: {name?: string; url?: string; branch?: string};
	}>('/git', async (req, reply) => {
		const body = (req.body ?? {}) as {
			name?: string;
			url?: string;
			branch?: string;
		};
		if (!body.url) {
			reply.code(400);
			return {ok: false, error: '`url` is required'};
		}

		const workspaceRoot =
			process.env.COREBRAIN_DEFAULT_WORKSPACE || '/app';
		if (!existsSync(workspaceRoot)) {
			try {
				mkdirSync(workspaceRoot, {recursive: true});
			} catch {
				reply.code(500);
				return {
					ok: false,
					error: `workspace dir ${workspaceRoot} missing and could not be created`,
				};
			}
		}
		try {
			if (!statSync(workspaceRoot).isDirectory()) {
				reply.code(500);
				return {
					ok: false,
					error: `workspace path ${workspaceRoot} is not a directory`,
				};
			}
		} catch {
			reply.code(500);
			return {ok: false, error: `workspace path ${workspaceRoot} not accessible`};
		}

		// Default folder name: derive from the repo URL (".../foo/bar.git" → "bar").
		const defaultName =
			body.name ??
			body.url
				.replace(/\/$/, '')
				.replace(/\.git$/i, '')
				.split('/')
				.pop() ??
			'repo';

		// Sanitize so we don't end up with something silly like "../etc" inside
		// /app. Letters, digits, dot, dash, underscore only — anything else
		// becomes "-".
		const safeName = defaultName.replace(/[^a-zA-Z0-9._-]/g, '-');
		const target = join(workspaceRoot, safeName);

		if (existsSync(target)) {
			reply.code(409);
			return {ok: false, error: `target dir already exists: ${target}`};
		}

		const args = ['clone', '--depth', '1'];
		if (body.branch) {
			args.push('--branch', body.branch, '--single-branch');
		}
		args.push(body.url, target);

		gatewayLog(`folder add (git): cloning ${body.url} → ${target}`);
		try {
			await execFileP('git', args, {
				timeout: 5 * 60_000, // 5 minutes
				env: process.env,
			});
		} catch (err) {
			reply.code(502);
			const stderr = (err as {stderr?: Buffer | string} | null)?.stderr;
			const message = stderr
				? Buffer.isBuffer(stderr)
					? stderr.toString('utf8')
					: stderr
				: err instanceof Error
					? err.message
					: 'git clone failed';
			gatewayLog(`folder add (git) FAILED: ${message.trim()}`);
			return {ok: false, error: message.trim()};
		}

		try {
			const folder = addFolder({
				name: safeName,
				path: target,
				scopes: ['files', 'coding', 'exec'],
			});
			gatewayLog(`folder added (git): ${folder.name} → ${folder.path}`);
			return {ok: true, folder};
		} catch (err) {
			reply.code(500);
			return {
				ok: false,
				error: err instanceof Error ? err.message : 'failed to register clone',
			};
		}
	});

	// ---- unregister (does not delete files on disk) ----
	app.delete<{Params: {idOrName: string}}>(
		'/:idOrName',
		async (req, reply) => {
			const {idOrName} = req.params;
			try {
				removeFolder(idOrName);
				gatewayLog(`folder removed: ${idOrName}`);
				return {ok: true};
			} catch (err) {
				reply.code(404);
				return {
					ok: false,
					error: err instanceof Error ? err.message : 'not found',
				};
			}
		},
	);
};
