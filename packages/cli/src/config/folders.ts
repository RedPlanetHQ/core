import {realpathSync, statSync, existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {homedir} from 'node:os';
import {randomUUID} from 'node:crypto';
import {getPreferences, updatePreferences} from './preferences';
import type {StoredFolder} from '@/types/config';

type Scope = StoredFolder['scopes'][number];

// `~/.corebrain` holds corebrain-managed state (worktrees, etc.) so it's
// implicitly registered with all scopes. This lets coding/files/exec tools
// operate on paths under it (e.g. ~/.corebrain/worktrees/<repo>/<branch>)
// without forcing the user to register it manually.
const COREBRAIN_HOME = resolve(homedir(), '.corebrain');
const COREBRAIN_HOME_FOLDER: StoredFolder = {
	id: 'fld_corebrain_home',
	name: 'corebrain',
	path: COREBRAIN_HOME,
	scopes: ['files', 'coding', 'exec'],
	gitRepo: false,
};

// Compare against realpath too — Railway's entrypoint symlinks
// /home/corebrain → /mnt/volume/corebrain-home, so the realpath'd input from
// `resolveFolderForPath` lives under the volume path while COREBRAIN_HOME is
// still the symlinked form. Same trick as the stored-folder loop below.
function isUnderCorebrainHome(abs: string): boolean {
	if (abs === COREBRAIN_HOME || abs.startsWith(COREBRAIN_HOME + '/')) {
		return true;
	}
	const real = realpathSafe(COREBRAIN_HOME);
	return abs === real || abs.startsWith(real + '/');
}

// Best-effort realpath. Used only for security in `resolveFolderForPath` —
// the stored folder path stays in the user-supplied form so symlinked
// workspaces (e.g. Railway's `/app → /mnt/volume/workspace`) show as `/app`
// in the UI and match the terminal's `pwd`.
function realpathSafe(p: string): string {
	try {
		return realpathSync(p);
	} catch {
		return p;
	}
}

export function listFolders(): StoredFolder[] {
	return getPreferences().gateway?.folders ?? [];
}

export function addFolder(input: {
	name?: string;
	path: string;
	scopes: Scope[];
}): StoredFolder {
	const inputPath = resolve(input.path);
	if (!existsSync(inputPath) || !statSync(inputPath).isDirectory()) {
		throw new Error(`Not a directory: ${inputPath}`);
	}

	const folders = listFolders();
	if (folders.some(f => f.path === inputPath)) {
		throw new Error(`Folder already registered: ${inputPath}`);
	}

	const name =
		input.name ?? inputPath.split('/').filter(Boolean).pop() ?? 'folder';
	if (folders.some(f => f.name === name)) {
		throw new Error(`Folder name in use: ${name}`);
	}

	if (!input.scopes || input.scopes.length === 0) {
		throw new Error('Folder must have at least one scope');
	}

	const folder: StoredFolder = {
		id: `fld_${randomUUID()}`,
		name,
		path: inputPath,
		scopes: Array.from(new Set(input.scopes)),
		gitRepo: existsSync(`${inputPath}/.git`),
	};

	const prefs = getPreferences();
	updatePreferences({
		gateway: {
			...(prefs.gateway ?? {pid: 0, startedAt: 0}),
			folders: [...folders, folder],
		},
	});
	return folder;
}

export function removeFolder(idOrName: string): void {
	const folders = listFolders();
	const next = folders.filter(
		f => f.id !== idOrName && f.name !== idOrName,
	);
	if (next.length === folders.length) {
		throw new Error(`Folder not found: ${idOrName}`);
	}
	const prefs = getPreferences();
	updatePreferences({
		gateway: {
			...(prefs.gateway ?? {pid: 0, startedAt: 0}),
			folders: next,
		},
	});
}

export function updateScopes(
	idOrName: string,
	op: {add?: Scope[]; remove?: Scope[]},
): StoredFolder {
	const folders = listFolders();
	let updated: StoredFolder | undefined;
	const next = folders.map(f => {
		if (f.id !== idOrName && f.name !== idOrName) return f;
		const set = new Set(f.scopes);
		for (const s of op.add ?? []) set.add(s);
		for (const s of op.remove ?? []) set.delete(s);
		if (set.size === 0) {
			throw new Error('Folder must have at least one scope');
		}
		updated = {...f, scopes: Array.from(set)};
		return updated;
	});
	if (!updated) throw new Error(`Folder not found: ${idOrName}`);
	const prefs = getPreferences();
	updatePreferences({
		gateway: {
			...(prefs.gateway ?? {pid: 0, startedAt: 0}),
			folders: next,
		},
	});
	return updated;
}

export function resolveFolderForPath(
	target: string,
	scope: Scope,
): {folder: StoredFolder; absPath: string} | null {
	let abs: string;
	try {
		abs = realpathSync(resolve(target));
	} catch {
		// If path doesn't exist yet, walk up to the nearest existing ancestor and
		// realpath that, then reattach the tail. This lets callers validate a
		// not-yet-created file against folder scopes.
		const resolved = resolve(target);
		const parts = resolved.split('/');
		let i = parts.length;
		let existingPath = '';
		while (i > 0) {
			existingPath = parts.slice(0, i).join('/') || '/';
			if (existsSync(existingPath)) break;
			i -= 1;
		}
		if (!existingPath) return null;
		const realExisting = realpathSync(existingPath);
		const tail = parts.slice(i).join('/');
		abs = tail ? `${realExisting}/${tail}` : realExisting;
	}

	if (isUnderCorebrainHome(abs)) {
		return {folder: COREBRAIN_HOME_FOLDER, absPath: abs};
	}

	// Compare against realpath of `f.path` too — `f.path` may be a symlink
	// (e.g. Railway's `/app → /mnt/volume/workspace`) while `abs` is already
	// the physical path.
	const folder = listFolders().find(f => {
		if (!f.scopes.includes(scope)) return false;
		if (abs === f.path || abs.startsWith(f.path + '/')) return true;
		const real = realpathSafe(f.path);
		return abs === real || abs.startsWith(real + '/');
	});
	return folder ? {folder, absPath: abs} : null;
}

export function getFolderById(id: string): StoredFolder | undefined {
	return listFolders().find(f => f.id === id);
}
