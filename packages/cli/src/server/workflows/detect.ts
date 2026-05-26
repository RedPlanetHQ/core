import { readdirSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import type { PluginSkill } from '@redplanethq/gateway-protocol';

/**
 * The two skill names that the superpowers plugin exposes WITHOUT the
 * `superpowers:` namespace prefix. Everything else uses `/superpowers:<name>`.
 */
const SUPERPOWERS_UNPREFIXED = new Set([
  'brainstorming',
  'writing-plans',
  'executing-plans',
]);

function safeReaddir(dir: string): string[] {
  if (!existsSync(dir)) return [];
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

function isDir(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Detect installed claude-code plugin skills. v1: walks
 *   <home>/.claude/plugins/cache/<org>/<plugin>/<version>/skills/<skill>/SKILL.md
 * and emits one entry per skill. The slash command form depends on the
 * plugin — currently we special-case superpowers's three unprefixed commands.
 *
 * `home` parameter is for testing; defaults to `os.homedir()`.
 */
export function detectPluginSkills(
  agent: string,
  home: string = homedir(),
): PluginSkill[] {
  if (agent !== 'claude-code') return [];
  const cacheRoot = join(home, '.claude', 'plugins', 'cache');
  const out: PluginSkill[] = [];
  for (const org of safeReaddir(cacheRoot)) {
    const orgDir = join(cacheRoot, org);
    if (!isDir(orgDir)) continue;
    for (const plugin of safeReaddir(orgDir)) {
      const pluginDir = join(orgDir, plugin);
      if (!isDir(pluginDir)) continue;
      const versions = safeReaddir(pluginDir).sort();
      for (const v of versions) {
        const skillsDir = join(pluginDir, v, 'skills');
        if (!existsSync(skillsDir)) continue;
        for (const skill of safeReaddir(skillsDir)) {
          const skillMd = join(skillsDir, skill, 'SKILL.md');
          if (!existsSync(skillMd)) continue;
          const command =
            plugin === 'superpowers' && SUPERPOWERS_UNPREFIXED.has(skill)
              ? `/${skill}`
              : `/${plugin}:${skill}`;
          out.push({ agent, plugin, skill, command });
        }
        break; // only consume the first version dir
      }
    }
  }
  out.sort((a, b) => a.command.localeCompare(b.command));
  return out;
}

/**
 * Quick yes/no — used by the resolver's preset-detector chain to decide
 * whether the superpowers preset applies.
 */
export function detectSuperpowersPresent(home: string = homedir()): boolean {
  const dir = join(
    home,
    '.claude',
    'plugins',
    'cache',
    'claude-plugins-official',
    'superpowers',
  );
  if (!existsSync(dir)) return false;
  return safeReaddir(dir).some((v) => isDir(join(dir, v)));
}
