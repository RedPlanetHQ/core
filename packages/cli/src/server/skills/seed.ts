import {existsSync, mkdirSync, copyFileSync, writeFileSync} from 'node:fs';
import {dirname, resolve, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {homedir} from 'node:os';
import {DEFAULT_SKILLS_DIR} from './skill-store';
import {gatewayLog} from '@/server/gateway-log';

const SENTINEL = resolve(homedir(), '.corebrain', '.skills-seeded');

function builtinPath(name: string): string {
  const here = dirname(fileURLToPath(import.meta.url));
  // Resolved from compiled output `dist/server/skills/seed.js` → up to dist root, then to builtin/.
  return resolve(here, 'builtin', name);
}

/**
 * Copy bundled builtin skills into `~/.corebrain/skills/` the first time the
 * daemon starts. Uses `~/.corebrain/.skills-seeded` as a sentinel so the user
 * can delete a builtin and have it stay deleted across restarts.
 */
export function seedBuiltinSkills(): void {
  if (existsSync(SENTINEL)) return;

  try {
    mkdirSync(DEFAULT_SKILLS_DIR, {recursive: true});

    const findSkillsDst = join(DEFAULT_SKILLS_DIR, 'find-skills');
    if (!existsSync(findSkillsDst)) {
      mkdirSync(findSkillsDst, {recursive: true});
      copyFileSync(
        join(builtinPath('find-skills'), 'SKILL.md'),
        join(findSkillsDst, 'SKILL.md'),
      );
      gatewayLog('seeded builtin skill: find-skills');
    }

    writeFileSync(SENTINEL, new Date().toISOString());
  } catch (err) {
    gatewayLog(
      `failed to seed builtin skills: ${err instanceof Error ? err.message : err}`,
    );
  }
}
