import {readdir, readFile, stat} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {homedir} from 'node:os';
import matter from 'gray-matter';
import type {GatewaySkill} from '@redplanethq/gateway-protocol';
import {gatewayLog} from '@/server/gateway-log';

export const DEFAULT_SKILLS_DIR = resolve(homedir(), '.corebrain', 'skills');

/**
 * Walk `<dir>/<name>/SKILL.md`, parse YAML frontmatter, return validated
 * skills. Skips entries that:
 *   - aren't directories or have no SKILL.md
 *   - have no `name` or `description` in frontmatter
 *   - have a `name` that doesn't match the containing directory
 * Each rejection is logged via `gatewayLog` so bad fixtures surface.
 */
export async function listSkills(dir: string = DEFAULT_SKILLS_DIR): Promise<GatewaySkill[]> {
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

		let parsed: ReturnType<typeof matter>;
		try {
			parsed = matter(await readFile(skillMd, 'utf8'));
		} catch (err) {
			gatewayLog(`skill ${name}: failed to parse SKILL.md (${err})`);
			continue;
		}

		const fm = parsed.data as Record<string, unknown>;
		const fmName = typeof fm.name === 'string' ? fm.name : null;
		const fmDesc = typeof fm.description === 'string' ? fm.description : null;
		if (!fmName || !fmDesc) {
			gatewayLog(`skill ${name}: missing required frontmatter (name/description)`);
			continue;
		}
		if (fmName !== name) {
			gatewayLog(`skill ${name}: frontmatter name "${fmName}" doesn't match directory`);
			continue;
		}

		const at = fm['allowed-tools'];
		const allowedTools =
			Array.isArray(at) && at.every(s => typeof s === 'string') ? (at as string[]) : undefined;

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
