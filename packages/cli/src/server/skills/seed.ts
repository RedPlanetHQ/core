import {existsSync, mkdirSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {DEFAULT_SKILLS_DIR} from './skill-store';
import {BUILTIN_SKILLS} from './builtins';
import {gatewayLog} from '@/server/gateway-log';

/**
 * Install bundled builtin skills into `~/.corebrain/skills/` whenever they're
 * not already present. Directory existence IS the "already installed" check
 * — no sentinel file. Trade-off: deleting a builtin won't stick across
 * restarts; remove the entry from BUILTIN_SKILLS if you want it gone for
 * good.
 */
export function seedBuiltinSkills(): void {
	try {
		mkdirSync(DEFAULT_SKILLS_DIR, {recursive: true});
		for (const {name, skillMd} of BUILTIN_SKILLS) {
			const dst = join(DEFAULT_SKILLS_DIR, name);
			if (existsSync(dst)) continue;
			mkdirSync(dst, {recursive: true});
			writeFileSync(join(dst, 'SKILL.md'), skillMd);
			gatewayLog(`seeded builtin skill: ${name}`);
		}
	} catch (err) {
		gatewayLog(
			`failed to seed builtin skills: ${err instanceof Error ? err.message : err}`,
		);
	}
}
