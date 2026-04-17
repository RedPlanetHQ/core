import React from 'react';

export function ChangeBars({ additions, deletions }: { additions: number; deletions: number }) {
  const total = (additions ?? 0) + (deletions ?? 0);
  if (total === 0) return null;
  const MAX = 5;
  const addBars = Math.round(((additions ?? 0) / total) * MAX);
  const delBars = MAX - addBars;
  const bar = (color: string, i: number) => (
    <span
      key={i}
      style={{
        display: 'inline-block',
        width: '6px',
        height: '10px',
        background: color,
        borderRadius: '1px',
      }}
    />
  );
  return (
    <span style={{ display: 'flex', gap: '1px', flexShrink: 0 }}>
      {Array.from({ length: addBars }, (_, i) => bar('#3fb950', i))}
      {Array.from({ length: delBars }, (_, i) => bar('#f85149', i + addBars))}
    </span>
  );
}
