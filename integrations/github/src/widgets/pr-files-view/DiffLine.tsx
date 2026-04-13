import React from 'react';
import type { PatchLine, LineType } from './api.js';

const BG: Record<LineType, string> = {
  hunk:    'rgba(56,139,253,0.08)',
  add:     'rgba(46,160,67,0.15)',
  remove:  'rgba(248,81,73,0.15)',
  context: 'transparent',
};

const TEXT_COLOR: Record<LineType, string> = {
  hunk:    '#79c0ff',
  add:     'inherit',
  remove:  'inherit',
  context: 'var(--muted-foreground)',
};

const PREFIX: Record<LineType, { char: string; color: string }> = {
  hunk:    { char: ' ', color: 'transparent' },
  add:     { char: '+', color: '#3fb950' },
  remove:  { char: '-', color: '#f85149' },
  context: { char: ' ', color: 'transparent' },
};

export function DiffLine({ line }: { line: PatchLine }) {
  const { char, color } = PREFIX[line.type];
  return (
    <div
      style={{
        display: 'flex',
        background: BG[line.type],
        color: TEXT_COLOR[line.type],
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        fontSize: '11px',
        lineHeight: '20px',
        whiteSpace: 'pre',
      }}
    >
      <span
        style={{
          width: '18px',
          minWidth: '18px',
          textAlign: 'center',
          color,
          userSelect: 'none',
          flexShrink: 0,
        }}
      >
        {char}
      </span>
      <span style={{ overflow: 'hidden' }}>{line.content}</span>
    </div>
  );
}
