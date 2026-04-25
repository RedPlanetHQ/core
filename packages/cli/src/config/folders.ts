import {realpathSync, statSync, existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {getPreferences, updatePreferences} from './preferences';
import type {StoredFolder} from '@/types/config';

type Scope = StoredFolder['scopes'][number];

export function listFolders(): StoredFolder[] {
	return getPreferences().gateway?.folders ?? [];
}

export function addFolder(input: {
	name?: string;
	path: string;
	scopes: Scope[];
}): StoredFolder {
	const abs = realpathSync(resolve(input.path));
	if (!existsSync(abs) || !statSync(abs).isDirectory()) {
		throw new Error(`Not a directory: ${abs}`);
	}

	const folders = listFolders();
	if (folders.some(f => f.path === abs)) {
		throw new Error(`Folder already registered: ${abs}`);
	}

	const name =
		input.name ?? abs.split('/').filter(Boolean).pop() ?? 'folder';
	if (folders.some(f => f.name === name)) {
		throw new Error(`Folder name in use: ${name}`);
	}

	if (!input.scopes || input.scopes.length === 0) {
		throw new Error('Folder must have at least one scope');
	}

	const folder: StoredFolder = {
		id: `fld_${randomUUID()}`,
		name,
		path: abs,
		scopes: Array.from(new Set(input.scopes)),
		gitRepo: existsSync(`${abs}/.git`),
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

	const folder = listFolders().find(
		f =>
			f.scopes.includes(scope) &&
			(abs === f.path || abs.startsWith(f.path + '/')),
	);
	return folder ? {folder, absPath: abs} : null;
}

export function getFolderById(id: string): StoredFolder | undefined {
	return listFolders().find(f => f.id === id);
}
