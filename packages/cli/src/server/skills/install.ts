import {mkdtempSync, rmSync, renameSync, existsSync} from 'node:fs';
import {mkdir, readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, isAbsolute} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import matter from 'gray-matter';
import type {GatewaySkill} from '@redplanethq/gateway-protocol';
import {DEFAULT_SKILLS_DIR} from './skill-store';
import {gatewayLog} from '@/server/gateway-log';

const execFileP = promisify(execFile);

const NAME_RE = /^[a-z0-9][a-z0-9-]*$/;

/**
 * Source description for `installSkill`. Currently only `url` is supported —
 * the gateway clones (optionally sparse-checkout'd) the repo and copies the
 * skill's directory into `~/.corebrain/skills/<name>/`.
 */
export interface InstallFromUrl {
	source: 'url';
	/** `https://...` or `git@host:org/repo` clone URL. */
	url: string;
	/**
	 * Optional path inside the cloned repo to the skill folder. When set, the
	 * gateway uses `git sparse-checkout` so only this subtree is fetched —
	 * cheap for skills inside a large monorepo like `RedPlanetHQ/core`.
	 * If omitted, `installFromUrl` looks for SKILL.md at the repo root (or
	 * one level down if `name` is provided).
	 */
	subdir?: string;
	/** Required when using `subdir`; otherwise inferred from frontmatter. */
	name?: string;
	/** If true, overwrite an existing skill with the same name. */
	force?: boolean;
}

export type InstallSource = InstallFromUrl;

export interface InstallOptions {
	/** Skills root directory. Defaults to `~/.corebrain/skills/`. */
	dir?: string;
}

/**
 * Install a skill from a git URL. Always stages in a temp dir and uses
 * `fs.rename` for the final move so partial installs never appear on disk.
 */
export async function installSkill(
	input: InstallSource,
	opts: InstallOptions = {},
): Promise<GatewaySkill> {
	const skillsDir = opts.dir ?? DEFAULT_SKILLS_DIR;
	await mkdir(skillsDir, {recursive: true});
	return installFromUrl(input, skillsDir);
}

async function installFromUrl(input: InstallFromUrl, skillsDir: string): Promise<GatewaySkill> {
	if (!/^https:\/\//.test(input.url) && !/^git@[\w.-]+:/.test(input.url)) {
		throw new Error(
			`install: URL must start with "https://" or "git@host:" — got "${input.url}"`,
		);
	}
	if (input.subdir) {
		assertSafeSubdir(input.subdir);
		if (!input.name) {
			throw new Error('install: `name` is required when `subdir` is set');
		}
		assertValidName(input.name);
	}

	const cloneDir = mkdtempSync(join(tmpdir(), 'corebrain-skill-clone-'));
	try {
		await gitClone(input.url, cloneDir, input.subdir);

		let sourceDir: string;
		let name: string;

		if (input.subdir) {
			sourceDir = join(cloneDir, input.subdir);
			if (!existsSync(join(sourceDir, 'SKILL.md'))) {
				throw new Error(
					`install: subdir "${input.subdir}" has no SKILL.md (looked at ${sourceDir})`,
				);
			}
			name = input.name as string;
			// Validate frontmatter name matches the requested install name so a
			// renamed skill folder can't masquerade as something else.
			const fm = matter(await readFile(join(sourceDir, 'SKILL.md'), 'utf8')).data as Record<
				string,
				unknown
			>;
			const fmName = typeof fm.name === 'string' ? fm.name : null;
			if (fmName && fmName !== name) {
				throw new Error(
					`install: SKILL.md frontmatter name "${fmName}" does not match install name "${name}"`,
				);
			}
		} else if (input.name) {
			assertValidName(input.name);
			sourceDir = join(cloneDir, input.name);
			if (!existsSync(join(sourceDir, 'SKILL.md'))) {
				throw new Error(
					`install: "${input.name}" not found in repo root (looked at ${sourceDir})`,
				);
			}
			name = input.name;
		} else if (existsSync(join(cloneDir, 'SKILL.md'))) {
			sourceDir = cloneDir;
			const fm = matter(await readFile(join(sourceDir, 'SKILL.md'), 'utf8')).data as Record<
				string,
				unknown
			>;
			if (typeof fm.name !== 'string') {
				throw new Error('install: repo root has SKILL.md but frontmatter is missing `name`');
			}
			name = fm.name;
			assertValidName(name);
		} else {
			throw new Error(
				'install: no SKILL.md found at repo root — pass `name` or `subdir` to locate the skill',
			);
		}

		const skillMd = await readFile(join(sourceDir, 'SKILL.md'), 'utf8');
		const meta = parseSkillMd(skillMd, name);

		const target = join(skillsDir, name);
		await ensureNoCollision(target, name, Boolean(input.force), skillsDir);

		renameSync(sourceDir, target);
		gatewayLog(`skill installed (url): ${name} from ${input.url}${input.subdir ? `#${input.subdir}` : ''}`);

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

export async function removeSkill(name: string, opts: InstallOptions = {}): Promise<void> {
	assertValidName(name);
	const skillsDir = opts.dir ?? DEFAULT_SKILLS_DIR;
	const target = join(skillsDir, name);
	if (!existsSync(target)) {
		throw new Error(`Skill '${name}' not found`);
	}
	rmSync(target, {recursive: true, force: true});
	gatewayLog(`skill removed: ${name}`);
}

// --- helpers ----------------------------------------------------------------

function assertValidName(name: string): void {
	if (!NAME_RE.test(name)) {
		throw new Error(
			`invalid skill name "${name}" — must match ${NAME_RE} (lowercase, kebab-case)`,
		);
	}
}

/**
 * Reject subdir inputs that try to escape the clone with `..` or absolute
 * paths. Empty segments are also rejected so a stray `//` doesn't slip past.
 */
function assertSafeSubdir(subdir: string): void {
	if (isAbsolute(subdir) || subdir.startsWith('/')) {
		throw new Error(`subdir must be relative: "${subdir}"`);
	}
	const segments = subdir.split('/');
	for (const seg of segments) {
		if (seg === '' || seg === '.' || seg === '..') {
			throw new Error(`subdir contains invalid segment "${seg}": "${subdir}"`);
		}
	}
}

function parseSkillMd(
	content: string,
	expectedName: string,
): {description: string; allowedTools?: string[]} {
	const parsed = matter(content);
	const fm = parsed.data as Record<string, unknown>;
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
		Array.isArray(at) && at.every(s => typeof s === 'string') ? (at as string[]) : undefined;
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
			`Skill '${name}' already installed. Use force=true to overwrite, or remove it first.`,
		);
	}
	await removeSkill(name, {dir: baseDir});
}

/**
 * Clone the repo into `cloneDir`. If `subdir` is set, do a sparse,
 * blob-filtered clone and only check out that subtree — this is what lets
 * the gateway install a skill out of a large monorepo without pulling
 * gigabytes of unrelated code.
 *
 * Sparse-checkout falls back to a regular shallow clone if any of the
 * sparse steps fail (older `git` versions, sparse not supported). The
 * sourceDir resolution downstream still works in that case — it just
 * means we pulled more than we needed.
 */
async function gitClone(url: string, cloneDir: string, subdir?: string): Promise<void> {
	const timeoutMs = 5 * 60_000;
	const exec = (args: string[]) => execFileP('git', args, {timeout: timeoutMs});

	if (!subdir) {
		await exec(['clone', '--depth=1', url, cloneDir]);
		return;
	}

	try {
		await exec(['clone', '--depth=1', '--filter=blob:none', '--sparse', url, cloneDir]);
		await execFileP('git', ['-C', cloneDir, 'sparse-checkout', 'set', subdir], {
			timeout: timeoutMs,
		});
		// Make sure the subdir actually exists post-checkout. Sparse-checkout is
		// quiet if the pattern matches nothing, so guard explicitly.
		if (!existsSync(join(cloneDir, subdir))) {
			throw new Error(`sparse-checkout produced no files for "${subdir}"`);
		}
	} catch (err) {
		// Best-effort fallback to a full shallow clone so callers don't get
		// blocked by old gits or unusual repos. The sourceDir lookup downstream
		// still works — we'll just have a bigger temp tree to delete.
		gatewayLog(
			`sparse-checkout failed for ${url}#${subdir}, falling back to full clone: ${
				err instanceof Error ? err.message : String(err)
			}`,
		);
		rmSync(cloneDir, {recursive: true, force: true});
		await mkdir(cloneDir, {recursive: true});
		await exec(['clone', '--depth=1', url, cloneDir]);
	}

}
