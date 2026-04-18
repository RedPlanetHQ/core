import React from 'react';
import type { ToolUI, ToolInput, ToolResult, ToolUIRenderContext, ToolUIComponent } from '@redplanethq/sdk';

// ─── Types ────────────────────────────────────────────────────────────────────

interface DimensionHeader { name: string }
interface MetricHeader { name: string; type?: string }
interface DimensionValue { value?: string | null }
interface MetricValue { value?: string | null }
interface ReportRow {
  dimensionValues?: DimensionValue[];
  metricValues?: MetricValue[];
}

interface GAReportData {
  dimensionHeaders?: DimensionHeader[];
  metricHeaders?: MetricHeader[];
  rows?: ReportRow[];
  rowCount?: number;
  metadata?: { currencyCode?: string; timeZone?: string };
}

// ─── Inline styles ────────────────────────────────────────────────────────────

const containerStyle: React.CSSProperties = {
  overflowX: 'auto',
  fontSize: 12,
  padding: '4px 0',
};

const tableStyle: React.CSSProperties = {
  borderCollapse: 'collapse',
  width: '100%',
  fontSize: 12,
  tableLayout: 'auto',
};

const thStyle: React.CSSProperties = {
  textAlign: 'left',
  padding: '4px 8px',
  borderBottom: '1px solid var(--border)',
  color: 'var(--muted-foreground)',
  fontWeight: 600,
  whiteSpace: 'nowrap',
};

const tdStyle: React.CSSProperties = {
  padding: '4px 8px',
  borderBottom: '1px solid var(--border)',
  color: 'var(--foreground)',
  whiteSpace: 'nowrap',
};

const metaTdStyle: React.CSSProperties = {
  ...tdStyle,
  fontVariantNumeric: 'tabular-nums',
  textAlign: 'right',
};

const errStyle: React.CSSProperties = {
  color: 'var(--destructive)',
  fontSize: 13,
  padding: '6px 0',
};

const pendingStyle: React.CSSProperties = {
  color: 'var(--muted-foreground)',
  fontSize: 13,
  padding: '6px 0',
  fontStyle: 'italic',
};

const summaryStyle: React.CSSProperties = {
  color: 'var(--muted-foreground)',
  fontSize: 11,
  marginTop: 4,
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function tryParseJSON(text: string): GAReportData | null {
  try {
    const parsed = JSON.parse(text);
    // Detect batch response
    if (parsed.reports && Array.isArray(parsed.reports)) {
      return parsed.reports[0] ?? null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function formatMetricValue(value: string | null | undefined): string {
  if (value == null) return '—';
  const n = parseFloat(value);
  if (isNaN(n)) return value;
  if (Number.isInteger(n)) return n.toLocaleString('en-US');
  return n.toFixed(2);
}

// ─── Report Table Component ───────────────────────────────────────────────────

function ReportTable({ data }: { data: GAReportData }) {
  const dimHeaders = data.dimensionHeaders ?? [];
  const metHeaders = data.metricHeaders ?? [];
  const rows = data.rows ?? [];
  const MAX_ROWS = 50;
  const displayRows = rows.slice(0, MAX_ROWS);

  return (
    <div style={containerStyle}>
      <table style={tableStyle}>
        <thead>
          <tr>
            {dimHeaders.map((h, i) => <th key={`d${i}`} style={thStyle}>{h.name}</th>)}
            {metHeaders.map((h, i) => <th key={`m${i}`} style={{ ...thStyle, textAlign: 'right' }}>{h.name}</th>)}
          </tr>
        </thead>
        <tbody>
          {displayRows.map((row, ri) => (
            <tr key={ri}>
              {(row.dimensionValues ?? []).map((dv, di) => (
                <td key={`d${di}`} style={tdStyle}>{dv.value ?? '(not set)'}</td>
              ))}
              {(row.metricValues ?? []).map((mv, mi) => (
                <td key={`m${mi}`} style={metaTdStyle}>{formatMetricValue(mv.value)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {data.rowCount !== undefined && (
        <div style={summaryStyle}>
          Showing {displayRows.length} of {data.rowCount.toLocaleString()} rows
          {data.metadata?.timeZone ? ` · ${data.metadata.timeZone}` : ''}
        </div>
      )}
    </div>
  );
}

// ─── Result view ─────────────────────────────────────────────────────────────

function ReportResultView({ result }: { result: ToolResult }) {
  if (result.isError) {
    return (
      <div style={errStyle}>
        {result.content[0]?.text ?? 'An error occurred.'}
      </div>
    );
  }

  const text = result.content[0]?.text ?? '';
  const data = tryParseJSON(text);

  if (!data || (!data.rows && !data.dimensionHeaders)) {
    // Not structured report data — render as plain text (e.g. list_properties, set_default_property)
    return (
      <pre style={{ fontSize: 12, whiteSpace: 'pre-wrap', wordBreak: 'break-word', color: 'var(--foreground)' }}>
        {text}
      </pre>
    );
  }

  return <ReportTable data={data} />;
}

// ─── Pending view (shown while tool is executing) ─────────────────────────────

function ReportPendingView({ toolName }: { toolName: string }) {
  return <div style={pendingStyle}>Running {toolName}…</div>;
}

// ─── ToolUI export ────────────────────────────────────────────────────────────

export const reportToolUI: ToolUI = {
  supported_tools: [
    'run_report',
    'run_realtime_report',
    'run_pivot_report',
    'batch_run_reports',
    'list_properties',
    'get_property',
    'get_metadata',
    'set_default_property',
  ],

  async render(
    toolName: string,
    _input: ToolInput,
    result: ToolResult | null,
    _context: ToolUIRenderContext,
    _submitInput: (input: ToolInput) => void,
    _onDecline: () => void,
  ): Promise<ToolUIComponent> {
    if (result === null) {
      return function Pending() {
        return <ReportPendingView toolName={toolName} />;
      };
    }

    return function Result() {
      return <ReportResultView result={result} />;
    };
  },
};
