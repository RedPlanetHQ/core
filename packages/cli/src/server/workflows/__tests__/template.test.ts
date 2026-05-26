import { describe, it, expect } from 'vitest';
import { interpolate } from '../template';

describe('interpolate', () => {
  it('substitutes simple variables', () => {
    expect(
      interpolate('hello {title}', { title: 'world', description: '' }),
    ).toBe('hello world');
  });

  it('wraps description in a fenced code block', () => {
    const out = interpolate('Task:\n{description}', {
      title: 't',
      description: 'Some user-supplied text',
    });
    expect(out).toBe('Task:\n```\nSome user-supplied text\n```');
  });

  it('renders missing variables as empty strings', () => {
    expect(
      interpolate('a {missing} b {title} c', { title: 'T', description: '' }),
    ).toBe('a  b T c');
  });

  it('handles all known variables', () => {
    const out = interpolate(
      '{title}|{description}|{answers}|{previousPhaseOutput}|{worktreePath}|{sessionId}',
      {
        title: 'T',
        description: 'D',
        answers: 'A',
        previousPhaseOutput: 'P',
        worktreePath: '/w',
        sessionId: 's1',
      },
    );
    expect(out).toBe('T|```\nD\n```|A|P|/w|s1');
  });

  it('does not double-wrap when description is empty', () => {
    expect(interpolate('a {description} b', { title: 't', description: '' })).toBe(
      'a  b',
    );
  });

  it('escapes a backtick fence inside description', () => {
    // User text containing ``` would otherwise close our fence early.
    const out = interpolate('{description}', {
      title: 't',
      description: 'See ```js\nfoo()\n``` for an example.',
    });
    expect(out).toMatch(/^```\n/);
    expect(out).toMatch(/\n```$/);
    // The inner fence should be escaped to break the closing match.
    expect(out).not.toMatch(/\n```\n.*\n```$/s);
  });
});
