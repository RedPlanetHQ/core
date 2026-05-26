import type {
  PluginSkill,
  GatewaySkill,
  WorkflowTrack,
} from '@redplanethq/gateway-protocol';

/**
 * Match the first slash command at the start of the prompt (after optional
 * whitespace). Captures the command up to the first whitespace.
 */
const SLASH_RE = /^\s*(\/[A-Za-z0-9_-]+(?::[A-Za-z0-9_-]+)?)/;

/**
 * Match any `<...>/.corebrain/skills/<name>/SKILL.md` substring inside the
 * prompt. Captures the skill name (the directory directly before SKILL.md).
 */
const SKILL_PATH_RE = /\.corebrain\/skills\/([A-Za-z0-9_-]+)\/SKILL\.md/g;

export function lintTrack(
  trackName: string,
  track: WorkflowTrack,
  agent: string,
  pluginSkills: PluginSkill[],
  skills: GatewaySkill[],
): string[] {
  const knownCommands = new Set(
    pluginSkills.filter((p) => p.agent === agent).map((p) => p.command),
  );
  const knownSkillNames = new Set(skills.map((s) => s.name));

  const unresolved: string[] = [];
  for (const phase of track.phases) {
    let bad = false;

    const slash = SLASH_RE.exec(phase.prompt);
    if (slash && !knownCommands.has(slash[1]!)) bad = true;

    if (!bad) {
      const pathMatches = phase.prompt.matchAll(SKILL_PATH_RE);
      for (const m of pathMatches) {
        if (!knownSkillNames.has(m[1]!)) {
          bad = true;
          break;
        }
      }
    }

    if (bad) unresolved.push(`${trackName}.${phase.name}`);
  }
  return unresolved;
}
