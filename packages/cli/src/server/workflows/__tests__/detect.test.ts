import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { detectPluginSkills, detectSuperpowersPresent } from '../detect';

describe('detectPluginSkills (claude-code)', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'pluginskills-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('returns [] when claude plugin dir does not exist', () => {
    expect(detectPluginSkills('claude-code', root)).toEqual([]);
  });

  it('discovers superpowers skills with the official slash form', () => {
    const skillsDir = join(
      root,
      '.claude/plugins/cache/claude-plugins-official/superpowers/5.1.0/skills',
    );
    mkdirSync(join(skillsDir, 'systematic-debugging'), { recursive: true });
    writeFileSync(
      join(skillsDir, 'systematic-debugging/SKILL.md'),
      '---\nname: systematic-debugging\ndescription: x\n---\nbody\n',
    );
    mkdirSync(join(skillsDir, 'brainstorming'), { recursive: true });
    writeFileSync(
      join(skillsDir, 'brainstorming/SKILL.md'),
      '---\nname: brainstorming\ndescription: y\n---\nbody\n',
    );

    const got = detectPluginSkills('claude-code', root);
    expect(got).toEqual([
      {
        agent: 'claude-code',
        plugin: 'superpowers',
        skill: 'brainstorming',
        command: '/brainstorming',
      },
      {
        agent: 'claude-code',
        plugin: 'superpowers',
        skill: 'systematic-debugging',
        command: '/superpowers:systematic-debugging',
      },
    ]);
  });

  it('returns [] for non-claude-code agents in v1', () => {
    expect(detectPluginSkills('codex-cli', root)).toEqual([]);
  });
});

describe('detectSuperpowersPresent', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'sp-present-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('returns false when no superpowers dir exists', () => {
    expect(detectSuperpowersPresent(root)).toBe(false);
  });

  it('returns true when at least one superpowers version dir exists', () => {
    mkdirSync(
      join(root, '.claude/plugins/cache/claude-plugins-official/superpowers/5.1.0'),
      { recursive: true },
    );
    expect(detectSuperpowersPresent(root)).toBe(true);
  });
});
