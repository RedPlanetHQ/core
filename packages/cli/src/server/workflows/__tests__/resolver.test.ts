import { describe, it, expect } from 'vitest';
import { resolveWorkflows } from '../resolver';
import type {
  PluginSkill,
  GatewaySkill,
} from '@redplanethq/gateway-protocol';

const noPluginSkills: PluginSkill[] = [];
const noSkills: GatewaySkill[] = [];

describe('resolveWorkflows', () => {
  it('falls back to preset:raw when nothing is detected and no config', () => {
    const out = resolveWorkflows({
      prefs: {},
      agentsConfigured: ['claude-code'],
      pluginSkills: noPluginSkills,
      skills: noSkills,
      superpowersPresent: false,
    });
    expect(out.source).toBe('preset:raw');
    expect(Object.keys(out.perAgent)).toEqual(['claude-code']);
    expect(out.perAgent['claude-code']!.bug.phases.length).toBeGreaterThanOrEqual(1);
    expect(out.perAgent['claude-code']!.feature.phases.length).toBeGreaterThanOrEqual(1);
  });

  it('uses superpowers preset when detected and no config override', () => {
    const out = resolveWorkflows({
      prefs: {},
      agentsConfigured: ['claude-code'],
      pluginSkills: noPluginSkills,
      skills: noSkills,
      superpowersPresent: true,
    });
    expect(out.source).toBe('preset:superpowers');
    expect(out.perAgent['claude-code']!.feature.phases[0]!.prompt).toMatch(
      /^\/brainstorming/,
    );
  });

  it('user config fully overrides preset for that agent + track', () => {
    const out = resolveWorkflows({
      prefs: {
        codingWorkflows: {
          'claude-code': {
            feature: {
              phases: [
                {
                  name: 'rfc',
                  prompt: 'Write RFC for {title}',
                  pollSeconds: 15,
                  advanceOn: 'done',
                },
              ],
            },
          },
        },
      },
      agentsConfigured: ['claude-code'],
      pluginSkills: noPluginSkills,
      skills: noSkills,
      superpowersPresent: true,
    });
    expect(out.source).toBe('config');
    expect(out.perAgent['claude-code']!.feature.phases).toHaveLength(1);
    expect(out.perAgent['claude-code']!.feature.phases[0]!.name).toBe('rfc');
    expect(out.perAgent['claude-code']!.bug.phases[0]!.prompt).toMatch(
      /systematic-debugging/,
    );
  });

  it('codex-cli falls through to raw because superpowers does not apply', () => {
    const out = resolveWorkflows({
      prefs: {},
      agentsConfigured: ['claude-code', 'codex-cli'],
      pluginSkills: noPluginSkills,
      skills: noSkills,
      superpowersPresent: true,
    });
    expect(out.perAgent['claude-code']!.bug.phases[0]!.prompt).toMatch(
      /systematic-debugging/,
    );
    expect(out.perAgent['codex-cli']!.bug.phases[0]!.prompt).not.toMatch(
      /superpowers/,
    );
  });

  it('records unresolved phases when config references a missing slash command', () => {
    const out = resolveWorkflows({
      prefs: {
        codingWorkflows: {
          'claude-code': {
            feature: {
              phases: [
                {
                  name: 'broken',
                  prompt: '/nope:cmd hi',
                  pollSeconds: 10,
                  advanceOn: 'done',
                },
              ],
            },
          },
        },
      },
      agentsConfigured: ['claude-code'],
      pluginSkills: noPluginSkills,
      skills: noSkills,
      superpowersPresent: false,
    });
    expect(out.perAgent['claude-code']!.unresolved).toContain('feature.broken');
  });
});
