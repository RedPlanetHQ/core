import React, { useState, useEffect, useCallback } from 'react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@redplanethq/ui/web';
import { callAction } from '../api.js';

export interface QueryResultCardProps {
  pat: string;
  accountId: string;
  baseUrl: string;
  initialConfig?: Record<string, string>;
}

interface ResultCol {
  name: string;
  display_name: string;
}

const s = {
  root: { width: '100%', borderRadius: '6px', overflow: 'hidden' } as React.CSSProperties,
  header: {
    padding: '8px 12px',
    borderBottom: '1px solid var(--border)',
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  } as React.CSSProperties,
  title: { fontSize: '12px', fontWeight: 600, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } as React.CSSProperties,
  meta: { fontSize: '11px', color: 'var(--muted-foreground)', flexShrink: 0 } as React.CSSProperties,
  form: { padding: '14px', display: 'flex', flexDirection: 'column', gap: '8px' } as React.CSSProperties,
  label: { fontSize: '11px', color: 'var(--muted-foreground)', display: 'block', marginBottom: '3px' } as React.CSSProperties,
  input: {
    width: '100%', padding: '5px 8px', fontSize: '12px', borderRadius: '4px',
    border: '1px solid var(--border)', background: 'var(--background)',
    color: 'var(--foreground)', boxSizing: 'border-box', outline: 'none',
  } as React.CSSProperties,
  btn: {
    padding: '5px 10px', fontSize: '12px', borderRadius: '4px',
    border: '1px solid var(--border)', background: 'var(--primary)',
    color: 'var(--primary-foreground)', cursor: 'pointer', fontWeight: 500,
  } as React.CSSProperties,
  hint: { fontSize: '11px', color: 'var(--muted-foreground)', margin: '0 0 10px' } as React.CSSProperties,
  skeleton: { padding: '20px', display: 'flex', flexDirection: 'column', gap: '6px' } as React.CSSProperties,
  skeletonLine: (w: number) => ({ height: '10px', width: `${w}%`, background: 'var(--muted)', borderRadius: '3px', opacity: 0.4 }) as React.CSSProperties,
  error: { padding: '10px 12px', fontSize: '12px', color: '#f85149', margin: 0 } as React.CSSProperties,
  empty: { padding: '12px', fontSize: '12px', color: 'var(--muted-foreground)', margin: 0 } as React.CSSProperties,
  tableWrap: { overflowX: 'auto', maxHeight: '400px', overflowY: 'auto' } as React.CSSProperties,
};

function MetabaseIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 32 32" fill="none">
      <circle cx="16" cy="16" r="16" fill="#509EE3"/>
      <circle cx="16" cy="16" r="7" fill="white"/>
    </svg>
  );
}

export function QueryResultCard({ pat, accountId, baseUrl, initialConfig }: QueryResultCardProps) {
  const [questionId, setQuestionId] = useState(initialConfig?.question_id ?? '');
  const [configured, setConfigured] = useState(!!initialConfig?.question_id);

  const [questionName, setQuestionName] = useState<string | null>(null);
  const [cols, setCols] = useState<ResultCol[]>([]);
  const [rows, setRows] = useState<unknown[][]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async (qId: string) => {
    setLoading(true); setError(null); setCols([]); setRows([]);
    try {
      const id = parseInt(qId, 10);
      const [question, result] = await Promise.all([
        callAction(baseUrl, accountId, pat, 'get_question', { id }),
        callAction(baseUrl, accountId, pat, 'execute_question', { id }),
      ]) as [any, any];

      setQuestionName(question?.name ?? `Question #${id}`);

      const data = result?.data ?? result;
      setCols(Array.isArray(data?.cols) ? data.cols : []);
      setRows(Array.isArray(data?.rows) ? data.rows : []);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load results');
    } finally {
      setLoading(false);
    }
  }, [baseUrl, accountId, pat]);

  useEffect(() => {
    if (configured && questionId) fetchData(questionId);
  }, [configured, questionId, fetchData]);

  if (!configured) {
    return (
      <div style={s.root}>
        <div style={s.header}>
          <MetabaseIcon />
          <span style={s.title}>Metabase Query</span>
        </div>
        <div style={s.form}>
          <p style={s.hint}>Show results from a saved Metabase question</p>
          <div>
            <label style={s.label}>Question ID</label>
            <input
              value={questionId}
              onChange={(e) => setQuestionId(e.target.value)}
              placeholder="e.g. 42"
              type="number"
              style={s.input}
            />
          </div>
          <button
            style={s.btn}
            onClick={() => { if (questionId.trim()) setConfigured(true); }}
          >
            Load
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={s.root}>
      <div style={s.header}>
        <MetabaseIcon />
        <span style={s.title}>{questionName ?? `Question #${questionId}`}</span>
        {!initialConfig?.question_id && (
          <button
            onClick={() => { setConfigured(false); setCols([]); setRows([]); setError(null); }}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted-foreground)', fontSize: '11px', padding: 0 }}
          >
            ✕
          </button>
        )}
      </div>

      {loading && (
        <div style={s.skeleton}>
          {[80, 60, 90, 70].map((w, i) => <div key={i} style={s.skeletonLine(w)} />)}
        </div>
      )}

      {!loading && error && <p style={s.error}>{error}</p>}

      {!loading && !error && cols.length === 0 && rows.length === 0 && (
        <p style={s.empty}>No results</p>
      )}

      {!loading && !error && cols.length > 0 && (
        <>
          <div style={{ padding: '4px 12px', borderBottom: '1px solid var(--border)', fontSize: '11px', color: 'var(--muted-foreground)' }}>
            {rows.length} row{rows.length !== 1 ? 's' : ''}
          </div>
          <div style={s.tableWrap}>
            <Table>
              <TableHeader>
                <TableRow>
                  {cols.map((col) => (
                    <TableHead key={col.name} style={{ fontSize: '11px', whiteSpace: 'nowrap' }}>
                      {col.display_name || col.name}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row, ri) => (
                  <TableRow key={ri}>
                    {(row as unknown[]).map((cell, ci) => (
                      <TableCell key={ci} style={{ fontSize: '12px', whiteSpace: 'nowrap' }}>
                        {cell === null || cell === undefined ? <span style={{ opacity: 0.4 }}>—</span> : String(cell)}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </>
      )}
    </div>
  );
}
