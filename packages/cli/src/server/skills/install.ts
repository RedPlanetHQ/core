import {
	mkdtempSync,
	rmSync,
	renameSync,
	existsSync,
	statSync,
	readdirSync,
} from 'node:fs';
import {mkdir, writeFile, readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, dirname, resolve, relative, isAbsolute} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import matter from 'gray-matter';
import type {GatewaySkill} from '@redplanethq/gateway-protocol';
import {DEFAULT_SKILLS_DIR} from './skill-store';
import {gatewayLog} from '@/server/gateway-log';

const execFileP = promisify(execFile);

const NAME_RE = /^[a-z0-9][a-z0-9-]*$/;

export type InstallSource =
	| {source: 'url'; url: string; skill?: string; force?: boolean}
	| {
			source: 'files';
			name: string;
			files: Record<string, string>;
			force?: boolean;
	  };

export interface InstallOptions {
	/** Skills root directory. Defaults to `~/.corebrain/skills/`. */
	dir?: string;
}

function assertValidName(name: string): void {
	if (!NAME_RE.test(name)) {
		throw new Error(
			`invalid skill name "${name}" — must match ${NAME_RE} (lowercase, kebab-case)`,
		);
	}
}

function assertPathInside(rel: string, baseAbs: string): void {
	if (isAbsolute(rel) || rel.startsWith('/')) {
		throw new Error(`file path escapes skill dir: "${rel}"`);
	}

	const resolved = resolve(baseAbs, rel);
	const rel2 = relative(baseAbs, resolved);
	if (rel2.startsWith('..') || isAbsolute(rel2)) {
		throw new Error(`file path escapes skill dir: "${rel}"`);
	}
}

function parseSkillMd(
	content: string,
	expectedName: string,
): {description: string; allowedTools?: string[]} {
	const parsed = matter(content);
	const fm = parsed.data as {
		name?: unknown;
		description?: unknown;
		['allowed-tools']?: unknown;
	};
	const fmName = typeof fm.name === 'string' ? fm.name : null;
	const fmDesc = typeof fm.description === 'string' ? fm.description : null;
	if (!fmName) throw new Error('SKILL.md frontmatter is missing `name`');
	if (!fmDesc) throw new Error('SKILL.md frontmatter is missing `description`');
	if (fmName !== expectedName) {
		throw new Error(
			`SKILL.md frontmatter name "${fmName}" does not match install name "${expectedName}"`,
		);
	}

	const at = fm['allowed-tools'];
	const allowedTools =
		Array.isArray(at) && at.every((s) => typeof s === 'string')
			? (at as string[])
			: undefined;
	return allowedTools ? {description: fmDesc, allowedTools} : {description: fmDesc};
}

async function ensureNoCollision(
	target: string,
	name: string,
	force: boolean,
	baseDir: string,
): Promise<void> {
	if (!existsSync(target)) return;
	if (!force) {
		throw new Error(
			`Skill '${name}' already installed. Use --force to overwrite, or 'corebrain skills remove ${name}' first.`,
		);
	}

	await removeSkill(name, {dir: baseDir});
}

/**
 * Install a skill from a git URL or from raw file content. Always writes
 * via a temp dir + `fs.rename` (same FS, so atomic on POSIX).
 */
export async function installSkill(
	input: InstallSource,
	opts: InstallOptions = {},
): Promise<GatewaySkill> {
	const skillsDir = opts.dir ?? DEFAULT_SKILLS_DIR;
	await mkdir(skillsDir, {recursive: true});

	if (input.source === 'files') {
		return installFromFiles(input, skillsDir);
	}

	return installFromUrl(input, skillsDir);
}

async function installFromFiles(
	input: Extract<InstallSource, {source: 'files'}>,
	skillsDir: string,
): Promise<GatewaySkill> {
	assertValidName(input.name);
	const target = join(skillsDir, input.name);

	// Stage in a temp dir, then atomic rename.
	const staging = mkdtempSync(join(tmpdir(), `corebrain-skill-${input.name}-`));
	try {
		const skillMdContent = input.files['SKILL.md'];
		if (!skillMdContent) {
			throw new Error('install: `files` map must include a "SKILL.md" entry');
		}

		const meta = parseSkillMd(skillMdContent, input.name);

		for (const [rel, content] of Object.entries(input.files)) {
			assertPathInside(rel, staging);
			const abs = resolve(staging, rel);
			await mkdir(dirname(abs), {recursive: true});
			await writeFile(abs, content);
		}

		await ensureNoCollision(target, input.name, Boolean(input.force), skillsDir);
		renameSync(staging, target);

		gatewayLog(`skill installed (files): ${input.name}`);
		return {
			name: input.name,
			description: meta.description,
			...(meta.allowedTools ? {allowedTools: meta.allowedTools} : {}),
			path: target,
		};
	} catch (err) {
		rmSync(staging, {recursive: true, force: true});
		throw err;
	}
}

async function installFromUrl(
	input: Extract<InstallSource, {source: 'url'}>,
	skillsDir: string,
): Promise<GatewaySkill> {
	if (
		!/^https:\/\//.test(input.url) &&
		!/^git@[\w.-]+:/.test(input.url)
	) {
		throw new Error(
			`install: URL must start with "https://" or "git@host:" — got "${input.url}"`,
		);
	}

	const cloneDir = mkdtempSync(join(tmpdir(), 'corebrain-skill-clone-'));
	try {
		await execFileP('git', ['clone', '--depth=1', input.url, cloneDir], {
			timeout: 5 * 60_000,
		});

		let sourceDir: string;
		let name: string;
		if (input.skill) {
			assertValidName(input.skill);
			sourceDir = join(cloneDir, input.skill);
			if (!existsSync(join(sourceDir, 'SKILL.md'))) {
				throw new Error(
					`install: --skill "${input.skill}" not found in repo (looked at ${sourceDir})`,
				);
			}

			name = input.skill;
		} else if (existsSync(join(cloneDir, 'SKILL.md'))) {
			sourceDir = cloneDir;
			const fm = matter(await readFile(join(sourceDir, 'SKILL.md'), 'utf8')).data;
			if (typeof fm.name !== 'string') {
				throw new Error(
					'install: repo root has SKILL.md but its frontmatter is missing `name`',
				);
			}

			name = fm.name;
			assertValidName(name);
		} else {
			const candidates = readdirSync(cloneDir).filter((entry) => {
				const p = join(cloneDir, entry);
				return (
					existsSync(join(p, 'SKILL.md')) && statSync(p).isDirectory()
				);
			});
			if (candidates.length === 0) {
				throw new Error(
					'install: no SKILL.md found at repo root or in any top-level folder',
				);
			}

			throw new Error(
				`install: repo contains multiple skills (${candidates.join(', ')}) — re-run with --skill <name>`,
			);
		}

		const skillMd = await readFile(join(sourceDir, 'SKILL.md'), 'utf8');
		const meta = parseSkillMd(skillMd, name);

		const target = join(skillsDir, name);
		await ensureNoCollision(target, name, Boolean(input.force), skillsDir);
		renameSync(sourceDir, target);

		gatewayLog(`skill installed (url): ${name} from ${input.url}`);
		return {
			name,
			description: meta.description,
			...(meta.allowedTools ? {allowedTools: meta.allowedTools} : {}),
			path: target,
		};
	} finally {
		rmSync(cloneDir, {recursive: true, force: true});
	}
}

export async function removeSkill(
	name: string,
	opts: InstallOptions = {},
): Promise<void> {
	assertValidName(name);
	const skillsDir = opts.dir ?? DEFAULT_SKILLS_DIR;
	const target = join(skillsDir, name);
	if (!existsSync(target)) {
		throw new Error(`Skill '${name}' not found`);
	}

	rmSync(target, {recursive: true, force: true});
	gatewayLog(`skill removed: ${name}`);
}
