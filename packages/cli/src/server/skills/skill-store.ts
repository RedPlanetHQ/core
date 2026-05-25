import {readdir, readFile, stat} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {homedir} from 'node:os';
import matter from 'gray-matter';
import {gatewayLog} from '@/server/gateway-log';
import type {GatewaySkill} from '@redplanethq/gateway-protocol';

export type {GatewaySkill};

export const DEFAULT_SKILLS_DIR = resolve(homedir(), '.corebrain', 'skills');

/**
 * Glob `<dir>/*\/SKILL.md`, parse YAML frontmatter, return validated skills.
 * Skips entries that:
 *   - have no SKILL.md
 *   - have no `name` or no `description`
 *   - have `name` that doesn't match the containing directory
 * Each rejection is logged via `gatewayLog` so the user can spot bad fixtures.
 */
export async function listSkills(
	dir: string = DEFAULT_SKILLS_DIR,
): Promise<GatewaySkill[]> {
	if (!existsSync(dir)) return [];

	let entries: string[];
	try {
		entries = await readdir(dir);
	} catch {
		return [];
	}

	const skills: GatewaySkill[] = [];
	for (const name of entries) {
		const skillDir = join(dir, name);
		let isDir = false;
		try {
			isDir = (await stat(skillDir)).isDirectory();
		} catch {
			continue;
		}

		if (!isDir) continue;

		const skillMd = join(skillDir, 'SKILL.md');
		try {
			await stat(skillMd);
		} catch {
			continue;
		}

		let parsed: matter.GrayMatterFile<string>;
		try {
			parsed = matter(await readFile(skillMd, 'utf8'));
		} catch (err) {
			gatewayLog(`skill ${name}: failed to parse SKILL.md (${err})`);
			continue;
		}

		const fm = parsed.data as {
			name?: unknown;
			description?: unknown;
			'allowed-tools'?: unknown;
		};
		const fmName = typeof fm.name === 'string' ? fm.name : null;
		const fmDesc = typeof fm.description === 'string' ? fm.description : null;
		if (!fmName || !fmDesc) {
			gatewayLog(
				`skill ${name}: missing required frontmatter (name/description)`,
			);
			continue;
		}

		if (fmName !== name) {
			gatewayLog(
				`skill ${name}: frontmatter name "${fmName}" doesn't match directory`,
			);
			continue;
		}

		let allowedTools: string[] | undefined;
		const at = fm['allowed-tools'];
		if (Array.isArray(at) && at.every((s) => typeof s === 'string')) {
			allowedTools = at as string[];
		}

		skills.push({
			name: fmName,
			description: fmDesc,
			...(allowedTools ? {allowedTools} : {}),
			path: skillDir,
		});
	}

	skills.sort((a, b) => a.name.localeCompare(b.name));
	return skills;
}
