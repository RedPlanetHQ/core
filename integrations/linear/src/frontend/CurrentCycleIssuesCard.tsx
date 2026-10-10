import React, { useState, useEffect, useCallback } from 'react';
import { callAction } from './api.js';
import { LinearIcon } from './icons/LinearIcon.js';

interface CycleIssue {
  id: string;
  identifier: string;
  title: string;
  url: string;
  priority?: number;
  estimate?: number;
  dueDate?: string | null;
  updatedAt: string;
  state?: { id: string; name: string; type: string; color?: string } | null;
  team?: { id: string; name: string; key: string } | null;
  project?: { id: string; name: string } | null;
  cycle?: { id: string; name?: string; number?: number; startsAt?: string; endsAt?: string } | null;
  labels?: Array<{ id: string; name: string; color?: string }>;
}

export interface CurrentCycleIssuesCardProps {
  pat: string;
  accountId: string;
  baseUrl: string;
  teamKey?: string;
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

const PRIORITY_LABEL: Record<number, string> = {
  1: 'Urgent',
  2: 'High',
  3: 'Medium',
  4: 'Low',
};

export function CurrentCycleIssuesCard({
  pat,
  accountId,
  baseUrl,
  teamKey,
}: CurrentCycleIssuesCardProps) {
  const [issues, setIssues] = useState<CycleIssue[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchIssues = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params: Record<string, unknown> = { first: 100 };
      if (teamKey && teamKey.trim()) params.teamKey = teamKey.trim();

      const result = (await callAction(
        baseUrl,
        accountId,
        pat,
        'linear_get_my_current_cycle_issues',
        params,
      )) as any; // eslint-disable-line @typescript-eslint/no-explicit-any

      const items: CycleIssue[] = result?.issues ?? (Array.isArray(result) ? result : []);
      setIssues(items);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load issues');
    } finally {
      setLoading(false);
    }
  }, [baseUrl, accountId, pat, teamKey]);

  useEffect(() => {
    fetchIssues();
  }, [fetchIssues]);

  const containerStyle: React.CSSProperties = {
    borderRadius: '6px',
    width: '100%',
    overflow: 'hidden',
  };

  const headerStyle: React.CSSProperties = {
    padding: '8px 10px',
    borderBottom: '1px solid var(--border)',
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
  };

  const headerTextStyle: React.CSSProperties = {
    fontSize: '12px',
    fontWeight: 600,
    flex: 1,
  };

  const refreshBtnStyle: React.CSSProperties = {
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    color: 'var(--muted-foreground)',
    fontSize: '11px',
    padding: 0,
    lineHeight: 1,
    flexShrink: 0,
  };

  const scopeLabel = teamKey && teamKey.trim() ? teamKey.trim() : 'All teams';

  return (
    <div style={containerStyle}>
      {/* Header */}
      <div style={headerStyle}>
        <LinearIcon />
        <span style={headerTextStyle}>Current Cycle Issues</span>
        <span style={{ fontSize: '10px', color: 'var(--muted-foreground)' }}>{scopeLabel}</span>
        {!loading && (
          <button onClick={fetchIssues} title="Refresh" style={refreshBtnStyle}>
            ↻
          </button>
        )}
      </div>

      {/* Loading skeleton */}
      {loading && (
        <div style={{ padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {[70, 85, 55].map((w, i) => (
            <div
              key={i}
              style={{
                height: '10px',
                width: `${w}%`,
                background: 'var(--muted)',
                borderRadius: '3px',
                opacity: 0.4,
              }}
            />
          ))}
        </div>
      )}

      {/* Error */}
      {!loading && error && (
        <p style={{ padding: '10px 12px', fontSize: '12px', color: '#f85149', margin: 0 }}>
          {error}
        </p>
      )}

      {/* Empty state */}
      {!loading && !error && issues.length === 0 && (
        <p
          style={{
            padding: '12px',
            fontSize: '12px',
            color: 'var(--muted-foreground)',
            margin: 0,
          }}
        >
          No issues assigned to you in the current cycle
        </p>
      )}

      {/* Issue list */}
      {!loading && !error && issues.length > 0 && (
        <div>
          {issues.map((issue, idx) => (
            <div
              key={issue.id}
              style={{
                padding: '8px 10px',
                borderBottom: idx < issues.length - 1 ? '1px solid var(--border)' : 'none',
                display: 'flex',
                flexDirection: 'column',
                gap: '3px',
              }}
            >
              {/* Identifier + priority row */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  justifyContent: 'space-between',
                }}
              >
                <span
                  style={{
                    fontSize: '10px',
                    color: 'var(--muted-foreground)',
                    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {issue.identifier}
                </span>
                <div style={{ display: 'flex', alignItems: 'center', gap: '4px', flexShrink: 0 }}>
                  {issue.state && (
                    <span
                      style={{
                        fontSize: '9px',
                        padding: '1px 5px',
                        borderRadius: '3px',
                        background: issue.state.color ? `${issue.state.color}33` : 'var(--muted)',
                        color: issue.state.color ?? 'var(--muted-foreground)',
                        fontWeight: 500,
                        border: issue.state.color
                          ? `1px solid ${issue.state.color}66`
                          : '1px solid var(--border)',
                      }}
                    >
                      {issue.state.name}
                    </span>
                  )}
                  {issue.priority && PRIORITY_LABEL[issue.priority] && (
                    <span
                      style={{
                        fontSize: '9px',
                        padding: '1px 5px',
                        borderRadius: '3px',
                        background: 'var(--muted)',
                        color: 'var(--muted-foreground)',
                        fontWeight: 500,
                      }}
                    >
                      {PRIORITY_LABEL[issue.priority]}
                    </span>
                  )}
                </div>
              </div>

              {/* Issue title */}
              <a
                href={issue.url}
                target="_blank"
                rel="noreferrer"
                style={{
                  fontSize: '12px',
                  fontWeight: 500,
                  color: 'var(--foreground)',
                  textDecoration: 'none',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  display: 'block',
                }}
              >
                {issue.title}
              </a>

              {/* Footer: team + labels + time */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '4px', flexWrap: 'wrap' }}>
                {issue.team && (
                  <span
                    style={{
                      fontSize: '9px',
                      padding: '1px 5px',
                      borderRadius: '3px',
                      background: 'var(--muted)',
                      color: 'var(--muted-foreground)',
                      fontWeight: 500,
                    }}
                  >
                    {issue.team.key}
                  </span>
                )}
                {issue.labels?.slice(0, 2).map((label) => (
                  <span
                    key={label.id}
                    style={{
                      fontSize: '9px',
                      padding: '1px 5px',
                      borderRadius: '10px',
                      background: label.color ? `${label.color}33` : 'var(--muted)',
                      color: label.color ?? 'var(--muted-foreground)',
                      fontWeight: 500,
                      border: label.color
                        ? `1px solid ${label.color}66`
                        : '1px solid var(--border)',
                    }}
                  >
                    {label.name}
                  </span>
                ))}
                <span
                  style={{
                    fontSize: '10px',
                    color: 'var(--muted-foreground)',
                    marginLeft: 'auto',
                  }}
                >
                  {timeAgo(issue.updatedAt)}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Footer count */}
      {!loading && !error && issues.length > 0 && (
        <div
          style={{
            padding: '5px 10px',
            borderTop: '1px solid var(--border)',
            fontSize: '10px',
            color: 'var(--muted-foreground)',
            textAlign: 'right',
          }}
        >
          {issues.length} issue{issues.length !== 1 ? 's' : ''}
        </div>
      )}
    </div>
  );
}
