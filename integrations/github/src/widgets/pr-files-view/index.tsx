import React, { useState, useEffect, useCallback } from 'react';
import type { PRFile, PRInfo, WidgetConfig } from './types.js';
import { callAction } from './api.js';
import { FileRow } from './FileRow.js';
import { ConfigForm } from './ConfigForm.js';
import { PRIcon } from './PRIcon.js';

export interface PRFilesCardProps {
  pat: string;
  accountId: string;
  baseUrl: string;
  initialConfig?: Record<string, string>;
}

export function PRFilesCard({ pat, accountId, baseUrl, initialConfig }: PRFilesCardProps) {
  const STORAGE_KEY = `github-pr-widget-${accountId}`;

  const [config, setConfig] = useState<WidgetConfig | null>(() => {
    if (initialConfig?.owner && initialConfig?.repo) {
      return {
        owner: initialConfig.owner,
        repo: initialConfig.repo,
        pull_number: initialConfig.pull_number,
      };
    }
    try {
      const s = localStorage.getItem(STORAGE_KEY);
      return s ? JSON.parse(s) : null;
    } catch {
      return null;
    }
  });

  const [pr, setPr] = useState<PRInfo | null>(null);
  const [files, setFiles] = useState<PRFile[]>([]);
  const [expandedFiles, setExpanded] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(
    async (cfg: WidgetConfig) => {
      setLoading(true);
      setError(null);
      setPr(null);
      setFiles([]);
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let pullNumber = cfg.pull_number ? parseInt(cfg.pull_number, 10) : undefined;
        if (!pullNumber) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const result = (await callAction(baseUrl, accountId, pat, 'search_pull_requests', {
            query: `repo:${cfg.owner}/${cfg.repo} is:pr is:open`,
            perPage: 1,
          })) as any;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const items: any[] = result?.items ?? (Array.isArray(result) ? result : []);
          if (!items.length) {
            setError('No open pull requests found');
            return;
          }
          pullNumber = items[0].number;
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const [prData, filesData] = (await Promise.all([
          callAction(baseUrl, accountId, pat, 'pull_request_read', {
            method: 'get',
            owner: cfg.owner,
            repo: cfg.repo,
            pullNumber,
          }),
          callAction(baseUrl, accountId, pat, 'pull_request_read', {
            method: 'get_files',
            owner: cfg.owner,
            repo: cfg.repo,
            pullNumber,
            perPage: 100,
          }),
        ])) as [any, any]; // eslint-disable-line @typescript-eslint/no-explicit-any
        if (!prData) {
          setError('Failed to load PR');
          return;
        }
        setPr({
          number: prData.number,
          title: prData.title,
          headRef: prData.head?.ref ?? '',
          baseRef: prData.base?.ref ?? 'main',
        });
        setFiles(Array.isArray(filesData) ? filesData : (filesData?.files ?? []));
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : 'Unknown error');
      } finally {
        setLoading(false);
      }
    },
    [baseUrl, accountId, pat],
  );

  useEffect(() => {
    if (config) fetchData(config);
  }, [config, fetchData]);

  const handleConfigure = (cfg: WidgetConfig) => {
    setConfig(cfg);
    if (!initialConfig?.owner) {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg));
      } catch {
        /* ignore */
      }
    }
  };

  const handleReset = () => {
    if (initialConfig?.owner) return;
    setConfig(null);
    setPr(null);
    setFiles([]);
    setError(null);
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
  };

  const toggleFile = (filename: string) =>
    setExpanded((prev) => {
      const n = new Set(prev);
      n.has(filename) ? n.delete(filename) : n.add(filename);
      return n;
    });

  const totalAdd = files.reduce((s, f) => s + (f.additions ?? 0), 0);
  const totalDel = files.reduce((s, f) => s + (f.deletions ?? 0), 0);

  const headerStyle: React.CSSProperties = {
    padding: '8px 10px',
    borderBottom: '1px solid var(--border)',
    display: 'flex',
    alignItems: 'flex-start',
    gap: '6px',
  };

  if (!config) {
    return (
      <div style={{ borderRadius: '6px', overflow: 'hidden', width: '100%' }}>
        <div style={{ ...headerStyle, alignItems: 'center' }}>
          <PRIcon />
          <span style={{ fontSize: '12px', fontWeight: 600 }}>GitHub PR Files</span>
        </div>
        <ConfigForm onSubmit={handleConfigure} />
      </div>
    );
  }

  return (
    <div style={{ borderRadius: '6px', width: '100%' }}>
      {/* Header */}
      <div style={headerStyle}>
        <PRIcon />
        <div style={{ flex: 1, minWidth: 0 }}>
          {pr ? (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                <span
                  style={{
                    fontSize: '12px',
                    fontWeight: 600,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {pr.title}
                </span>
                <span style={{ fontSize: '11px', color: 'var(--muted-foreground)', flexShrink: 0 }}>
                  #{pr.number}
                </span>
              </div>
              <div
                style={{
                  fontSize: '10px',
                  color: 'var(--muted-foreground)',
                  marginTop: '1px',
                  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                }}
              >
                {pr.headRef} → {pr.baseRef}
              </div>
            </>
          ) : (
            <span style={{ fontSize: '12px', fontWeight: 600 }}>
              {config.owner}/{config.repo}
            </span>
          )}
        </div>
        {!initialConfig?.owner && (
          <button
            onClick={handleReset}
            title="Change repository"
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: 'var(--muted-foreground)',
              fontSize: '11px',
              padding: 0,
              lineHeight: 1,
              flexShrink: 0,
            }}
          >
            ✕
          </button>
        )}
      </div>

      {/* Loading skeleton */}
      {loading && (
        <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
          {[80, 60, 90].map((w, i) => (
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

      {/* Stats bar */}
      {!loading && !error && files.length > 0 && (
        <div
          style={{
            padding: '4px 10px',
            borderBottom: '1px solid var(--border)',
            display: 'flex',
            gap: '10px',
            fontSize: '11px',
            color: 'var(--muted-foreground)',
          }}
        >
          <span>
            {files.length} file{files.length !== 1 ? 's' : ''} changed
          </span>
          <span style={{ color: '#3fb950' }}>+{totalAdd}</span>
          <span style={{ color: '#f85149' }}>-{totalDel}</span>
        </div>
      )}

      {/* Empty */}
      {!loading && !error && files.length === 0 && (
        <p
          style={{ padding: '12px', fontSize: '12px', color: 'var(--muted-foreground)', margin: 0 }}
        >
          No files changed
        </p>
      )}

      {/* File list */}
      {!loading && !error && files.length > 0 && (
        <div>
          {files.map((file) => (
            <FileRow
              key={file.filename}
              file={file}
              expanded={expandedFiles.has(file.filename)}
              onToggle={() => toggleFile(file.filename)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
