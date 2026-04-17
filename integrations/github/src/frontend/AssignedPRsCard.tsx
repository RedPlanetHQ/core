import React, { useState, useEffect, useCallback } from 'react';
import { callAction } from './pr-files-view/api.js';
import { PRIcon } from './icons/PRIcon.js';

interface AssignedPR {
  number: number;
  title: string;
  html_url: string;
  draft: boolean;
  repository_url: string;
  updated_at: string;
  labels: Array<{ name: string; color: string }>;
  requested_reviewers?: Array<{ login: string }>;
}

export interface AssignedPRsCardProps {
  pat: string;
  accountId: string;
  baseUrl: string;
}

function repoFromUrl(repositoryUrl: string): string {
  // https://api.github.com/repos/owner/repo → owner/repo
  const match = repositoryUrl.match(/repos\/(.+)$/);
  return match ? match[1] : repositoryUrl;
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export function AssignedPRsCard({ pat, accountId, baseUrl }: AssignedPRsCardProps) {
  const [prs, setPrs] = useState<AssignedPR[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchPRs = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = (await callAction(baseUrl, accountId, pat, 'search_pull_requests', {
        query: 'is:pr is:open assignee:@me',
        perPage: 20,
      })) as any; // eslint-disable-line @typescript-eslint/no-explicit-any

      const items: AssignedPR[] = result?.items ?? (Array.isArray(result) ? result : []);
      setPrs(items);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load PRs');
    } finally {
      setLoading(false);
    }
  }, [baseUrl, accountId, pat]);

  useEffect(() => {
    fetchPRs();
  }, [fetchPRs]);

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

  return (
    <div style={containerStyle}>
      {/* Header */}
      <div style={headerStyle}>
        <PRIcon />
        <span style={headerTextStyle}>Assigned PRs</span>
        {!loading && (
          <button onClick={fetchPRs} title="Refresh" style={refreshBtnStyle}>
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
      {!loading && !error && prs.length === 0 && (
        <p
          style={{
            padding: '12px',
            fontSize: '12px',
            color: 'var(--muted-foreground)',
            margin: 0,
          }}
        >
          No open PRs assigned to you
        </p>
      )}

      {/* PR list */}
      {!loading && !error && prs.length > 0 && (
        <div>
          {prs.map((pr, idx) => (
            <div
              key={pr.number}
              style={{
                padding: '8px 10px',
                borderBottom: idx < prs.length - 1 ? '1px solid var(--border)' : 'none',
                display: 'flex',
                flexDirection: 'column',
                gap: '3px',
              }}
            >
              {/* Repo + PR number row */}
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
                  {repoFromUrl(pr.repository_url)}
                </span>
                <div style={{ display: 'flex', alignItems: 'center', gap: '4px', flexShrink: 0 }}>
                  {pr.draft && (
                    <span
                      style={{
                        fontSize: '9px',
                        padding: '1px 4px',
                        borderRadius: '3px',
                        background: 'var(--muted)',
                        color: 'var(--muted-foreground)',
                        fontWeight: 500,
                      }}
                    >
                      Draft
                    </span>
                  )}
                  <span style={{ fontSize: '10px', color: 'var(--muted-foreground)' }}>
                    #{pr.number}
                  </span>
                </div>
              </div>

              {/* PR title */}
              <a
                href={pr.html_url}
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
                {pr.title}
              </a>

              {/* Footer: labels + time */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '4px', flexWrap: 'wrap' }}>
                {pr.labels?.slice(0, 3).map((label) => (
                  <span
                    key={label.name}
                    style={{
                      fontSize: '9px',
                      padding: '1px 5px',
                      borderRadius: '10px',
                      background: `#${label.color}33`,
                      color: `#${label.color}`,
                      fontWeight: 500,
                      border: `1px solid #${label.color}66`,
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
                  {timeAgo(pr.updated_at)}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Footer count */}
      {!loading && !error && prs.length > 0 && (
        <div
          style={{
            padding: '5px 10px',
            borderTop: '1px solid var(--border)',
            fontSize: '10px',
            color: 'var(--muted-foreground)',
            textAlign: 'right',
          }}
        >
          {prs.length} PR{prs.length !== 1 ? 's' : ''}
        </div>
      )}
    </div>
  );
}
