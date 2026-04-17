import React, { useState } from 'react';
import type { WidgetConfig } from './types.js';

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '5px 8px',
  fontSize: '12px',
  borderRadius: '4px',
  border: '1px solid var(--border)',
  background: 'var(--background)',
  color: 'var(--foreground)',
  boxSizing: 'border-box',
  outline: 'none',
};

function Field({ label, children }: { label: React.ReactNode; children: React.ReactNode }) {
  return (
    <div>
      <label style={{ fontSize: '11px', color: 'var(--muted-foreground)', display: 'block', marginBottom: '3px' }}>
        {label}
      </label>
      {children}
    </div>
  );
}

export function ConfigForm({ onSubmit }: { onSubmit: (cfg: WidgetConfig) => void }) {
  const [owner, setOwner] = useState('');
  const [repo, setRepo] = useState('');
  const [pr, setPr] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!owner.trim() || !repo.trim()) return;
    onSubmit({ owner: owner.trim(), repo: repo.trim(), pull_number: pr.trim() || undefined });
  };

  return (
    <div style={{ padding: '14px' }}>
      <p style={{ fontSize: '11px', color: 'var(--muted-foreground)', margin: '0 0 10px' }}>
        Configure a repository to view PR file changes
      </p>
      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        <Field label="Owner">
          <input value={owner} onChange={(e) => setOwner(e.target.value)} placeholder="e.g. RedPlanetHQ" style={inputStyle} />
        </Field>
        <Field label="Repository">
          <input value={repo} onChange={(e) => setRepo(e.target.value)} placeholder="e.g. core" style={inputStyle} />
        </Field>
        <Field label={<>PR number <span style={{ opacity: 0.6 }}>(empty = latest open)</span></>}>
          <input value={pr} onChange={(e) => setPr(e.target.value)} placeholder="e.g. 241" type="number" style={inputStyle} />
        </Field>
        <button
          type="submit"
          style={{
            padding: '5px 10px', fontSize: '12px', borderRadius: '4px',
            border: '1px solid var(--border)', background: 'var(--primary)',
            color: 'var(--primary-foreground)', cursor: 'pointer', fontWeight: 500, marginTop: '2px',
          }}
        >
          Load
        </button>
      </form>
    </div>
  );
}
