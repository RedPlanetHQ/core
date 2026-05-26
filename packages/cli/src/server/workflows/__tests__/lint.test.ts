import { describe, it, expect } from 'vitest';
import { lintTrack } from '../lint';
import type {
  PluginSkill,
  GatewaySkill,
  WorkflowTrack,
} from '@redplanethq/gateway-protocol';

const pluginSkills: PluginSkill[] = [
  {
    agent: 'claude-code',
    plugin: 'superpowers',
    skill: 'systematic-debugging',
    command: '/superpowers:systematic-debugging',
  },
  {
    agent: 'claude-code',
    plugin: 'superpowers',
    skill: 'brainstorming',
    command: '/brainstorming',
  },
];

const skills: GatewaySkill[] = [
  { name: 'find-skills', description: 'x', path: '/Users/x/.corebrain/skills/find-skills' },
];

const track: WorkflowTrack = {
  phases: [
    { name: 'a', prompt: '/brainstorming hi', pollSeconds: 20, advanceOn: 'user-approval' },
    { name: 'b', prompt: '/foo:bar hi', pollSeconds: 20, advanceOn: 'user-approval' },
    {
      name: 'c',
      prompt: 'Read /Users/x/.corebrain/skills/find-skills/SKILL.md',
      pollSeconds: 30,
      advanceOn: 'done',
    },
    {
      name: 'd',
      prompt: 'Read /Users/x/.corebrain/skills/missing-one/SKILL.md',
      pollSeconds: 30,
      advanceOn: 'done',
    },
    {
      name: 'e',
      prompt: 'Just plain prose for {title}',
      pollSeconds: 20,
      advanceOn: 'done',
    },
  ],
};

describe('lintTrack', () => {
  it('flags unknown slash commands and missing skill paths but not prose', () => {
    const got = lintTrack('feature', track, 'claude-code', pluginSkills, skills);
    expect(got).toEqual(['feature.b', 'feature.d']);
  });

  it('returns [] when everything resolves', () => {
    const ok: WorkflowTrack = {
      phases: [track.phases[0], track.phases[2], track.phases[4]],
    };
    expect(lintTrack('bug', ok, 'claude-code', pluginSkills, skills)).toEqual([]);
  });
});
