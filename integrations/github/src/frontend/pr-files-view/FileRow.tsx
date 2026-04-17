import React from 'react';
import type { PRFile } from './types.js';
import { parsePatch } from './api.js';
import { DiffLine } from './DiffLine.js';
import { ChangeBars } from './ChangeBars.js';

const STATUS_BADGE: Record<string, { label: string; color: string; bg: string }> = {
  added:    { label: 'A', color: '#3fb950', bg: 'rgba(46,160,67,0.15)' },
  removed:  { label: 'D', color: '#f85149', bg: 'rgba(248,81,73,0.15)' },
  modified: { label: 'M', color: '#d29922', bg: 'rgba(210,153,34,0.15)' },
  renamed:  { label: 'R', color: '#58a6ff', bg: 'rgba(88,166,255,0.15)' },
  copied:   { label: 'C', color: '#58a6ff', bg: 'rgba(88,166,255,0.15)' },
  changed:  { label: 'M', color: '#d29922', bg: 'rgba(210,153,34,0.15)' },
};

export function FileRow({
  file,
  expanded,
  onToggle,
}: {
  file: PRFile;
  expanded: boolean;
  onToggle: () => void;
}) {
  const badge = STATUS_BADGE[file.status] ?? STATUS_BADGE.modified;
  const lines = file.patch ? parsePatch(file.patch) : [];

  return (
    <div style={{ borderBottom: '1px solid var(--border)' }}>
      <div
        onClick={onToggle}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          padding: '5px 10px',
          cursor: 'pointer',
          userSelect: 'none',
        }}
        onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.04)'; }}
        onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
      >
        <span style={{ color: 'var(--muted-foreground)', fontSize: '9px', width: '10px', flexShrink: 0 }}>
          {expanded ? '▾' : '▸'}
        </span>
        <span
          style={{
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            width: '15px', height: '15px', borderRadius: '3px',
            fontSize: '9px', fontWeight: 700,
            color: badge.color, background: badge.bg, flexShrink: 0,
          }}
        >
          {badge.label}
        </span>
        <span
          style={{
            flex: 1,
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
            fontSize: '11px',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {file.previous_filename ? (
            <>
              <span style={{ color: 'var(--muted-foreground)' }}>{file.previous_filename}</span>
              {' → '}
              {file.filename}
            </>
          ) : (
            file.filename
          )}
        </span>
        <span style={{ display: 'flex', gap: '4px', flexShrink: 0, fontSize: '11px' }}>
          {(file.additions ?? 0) > 0 && (
            <span style={{ color: '#3fb950', fontWeight: 500 }}>+{file.additions}</span>
          )}
          {(file.deletions ?? 0) > 0 && (
            <span style={{ color: '#f85149', fontWeight: 500 }}>-{file.deletions}</span>
          )}
        </span>
        <ChangeBars additions={file.additions ?? 0} deletions={file.deletions ?? 0} />
      </div>

      {expanded && (
        <div style={{ borderTop: '1px solid var(--border)', overflowX: 'auto' }}>
          {lines.length > 0 ? (
            lines.map((l, i) => <DiffLine key={i} line={l} />)
          ) : (
            <p style={{ padding: '10px 12px', fontSize: '11px', color: 'var(--muted-foreground)', fontStyle: 'italic', margin: 0 }}>
              Binary file — no diff available
            </p>
          )}
        </div>
      )}
    </div>
  );
}
