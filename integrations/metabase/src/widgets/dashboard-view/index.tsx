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

export interface DashboardCardProps {
  pat: string;
  accountId: string;
  baseUrl: string;
  initialConfig?: Record<string, string>;
}

interface DashCard {
  id: number;
  card: { id: number; name: string; display?: string } | null;
}

interface ResultCol { name: string; display_name: string; }

const s = {
  root: { width: '100%', borderRadius: '6px', overflow: 'hidden' } as React.CSSProperties,
  header: { padding: '8px 12px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: '8px' } as React.CSSProperties,
  title: { fontSize: '12px', fontWeight: 600, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } as React.CSSProperties,
  meta: { fontSize: '11px', color: 'var(--muted-foreground)', flexShrink: 0 } as React.CSSProperties,
  form: { padding: '14px', display: 'flex', flexDirection: 'column', gap: '8px' } as React.CSSProperties,
  label: { fontSize: '11px', color: 'var(--muted-foreground)', display: 'block', marginBottom: '3px' } as React.CSSProperties,
  input: { width: '100%', padding: '5px 8px', fontSize: '12px', borderRadius: '4px', border: '1px solid var(--border)', background: 'var(--background)', color: 'var(--foreground)', boxSizing: 'border-box', outline: 'none' } as React.CSSProperties,
  btn: { padding: '5px 10px', fontSize: '12px', borderRadius: '4px', border: '1px solid var(--border)', background: 'var(--primary)', color: 'var(--primary-foreground)', cursor: 'pointer', fontWeight: 500 } as React.CSSProperties,
  hint: { fontSize: '11px', color: 'var(--muted-foreground)', margin: '0 0 10px' } as React.CSSProperties,
  skeleton: { padding: '20px', display: 'flex', flexDirection: 'column', gap: '6px' } as React.CSSProperties,
  skeletonLine: (w: number) => ({ height: '10px', width: `${w}%`, background: 'var(--muted)', borderRadius: '3px', opacity: 0.4 }) as React.CSSProperties,
  error: { padding: '10px 12px', fontSize: '12px', color: '#f85149', margin: 0 } as React.CSSProperties,
  empty: { padding: '12px', fontSize: '12px', color: 'var(--muted-foreground)', margin: 0 } as React.CSSProperties,
  cardRow: (expanded: boolean) => ({
    borderBottom: '1px solid var(--border)',
    background: expanded ? 'var(--accent)' : 'transparent',
  }) as React.CSSProperties,
  cardRowHeader: { padding: '8px 12px', display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' } as React.CSSProperties,
  cardName: { fontSize: '12px', flex: 1 } as React.CSSProperties,
  cardMeta: { fontSize: '10px', color: 'var(--muted-foreground)' } as React.CSSProperties,
  tableWrap: { overflowX: 'auto', maxHeight: '300px', overflowY: 'auto', borderTop: '1px solid var(--border)' } as React.CSSProperties,
};

function MetabaseIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 32 32" fill="none">
      <circle cx="16" cy="16" r="16" fill="#509EE3"/>
      <circle cx="16" cy="16" r="7" fill="white"/>
    </svg>
  );
}

function ChevronIcon({ expanded }: { expanded: boolean }) {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" style={{ transform: expanded ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s', flexShrink: 0 }}>
      <path d="M4.5 2.5L7.5 6L4.5 9.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}

function CardResult({ cardId, pat, accountId, baseUrl }: { cardId: number; pat: string; accountId: string; baseUrl: string }) {
  const [cols, setCols] = useState<ResultCol[]>([]);
  const [rows, setRows] = useState<unknown[][]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const result = await callAction(baseUrl, accountId, pat, 'execute_question', { id: cardId }) as any;
        const data = result?.data ?? result;
        setCols(Array.isArray(data?.cols) ? data.cols : []);
        setRows(Array.isArray(data?.rows) ? data.rows : []);
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : 'Failed to load');
      } finally {
        setLoading(false);
      }
    })();
  }, [cardId, pat, accountId, baseUrl]);

  if (loading) {
    return (
      <div style={s.skeleton}>
        {[80, 60, 90].map((w, i) => <div key={i} style={s.skeletonLine(w)} />)}
      </div>
    );
  }
  if (error) return <p style={s.error}>{error}</p>;
  if (!cols.length) return <p style={s.empty}>No results</p>;

  return (
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
  );
}

export function DashboardCard({ pat, accountId, baseUrl, initialConfig }: DashboardCardProps) {
  const [dashboardId, setDashboardId] = useState(initialConfig?.dashboard_id ?? '');
  const [configured, setConfigured] = useState(!!initialConfig?.dashboard_id);

  const [dashName, setDashName] = useState<string | null>(null);
  const [cards, setCards] = useState<DashCard[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  const fetchDashboard = useCallback(async (dId: string) => {
    setLoading(true); setError(null); setCards([]);
    try {
      const dash = await callAction(baseUrl, accountId, pat, 'get_dashboard', { id: parseInt(dId, 10) }) as any;
      setDashName(dash?.name ?? `Dashboard #${dId}`);
      setCards((dash?.dashcards ?? []).filter((dc: DashCard) => dc.card !== null));
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load dashboard');
    } finally {
      setLoading(false);
    }
  }, [baseUrl, accountId, pat]);

  useEffect(() => {
    if (configured && dashboardId) fetchDashboard(dashboardId);
  }, [configured, dashboardId, fetchDashboard]);

  const toggleCard = (id: number) =>
    setExpanded(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });

  if (!configured) {
    return (
      <div style={s.root}>
        <div style={s.header}>
          <MetabaseIcon />
          <span style={s.title}>Metabase Dashboard</span>
        </div>
        <div style={s.form}>
          <p style={s.hint}>Show questions from a Metabase dashboard</p>
          <div>
            <label style={s.label}>Dashboard ID</label>
            <input
              value={dashboardId}
              onChange={(e) => setDashboardId(e.target.value)}
              placeholder="e.g. 1"
              type="number"
              style={s.input}
            />
          </div>
          <button style={s.btn} onClick={() => { if (dashboardId.trim()) setConfigured(true); }}>
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
        <span style={s.title}>{dashName ?? `Dashboard #${dashboardId}`}</span>
        <span style={s.meta}>{cards.length} question{cards.length !== 1 ? 's' : ''}</span>
        {!initialConfig?.dashboard_id && (
          <button
            onClick={() => { setConfigured(false); setCards([]); setError(null); setExpanded(new Set()); }}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted-foreground)', fontSize: '11px', padding: 0 }}
          >
            ✕
          </button>
        )}
      </div>

      {loading && (
        <div style={s.skeleton}>
          {[70, 85, 60, 80].map((w, i) => <div key={i} style={s.skeletonLine(w)} />)}
        </div>
      )}

      {!loading && error && <p style={s.error}>{error}</p>}

      {!loading && !error && cards.length === 0 && (
        <p style={s.empty}>No questions in this dashboard</p>
      )}

      {!loading && !error && cards.map((dc) => {
        const card = dc.card!;
        const isExpanded = expanded.has(dc.id);
        return (
          <div key={dc.id} style={s.cardRow(isExpanded)}>
            <div style={s.cardRowHeader} onClick={() => toggleCard(dc.id)}>
              <ChevronIcon expanded={isExpanded} />
              <span style={s.cardName}>{card.name}</span>
              {card.display && <span style={s.cardMeta}>{card.display}</span>}
            </div>
            {isExpanded && (
              <CardResult cardId={card.id} pat={pat} accountId={accountId} baseUrl={baseUrl} />
            )}
          </div>
        );
      })}
    </div>
  );
}
