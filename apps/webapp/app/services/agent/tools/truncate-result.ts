/**
 * Cap the size of tool-call result strings before they are handed back to the
 * model. A single oversized response (a long exec stdout, a large integration
 * payload) otherwise pins megabytes in the agent's message history for the
 * rest of the session and pushes us toward the 8 GB heap cap.
 *
 * Strategy: keep the head and the tail; drop the middle and replace it with a
 * self-describing marker that tells the model *exactly* what happened and how
 * to fix the next call. Tail bias is intentional — for shell-style output the
 * trailing bytes (exit error, final summary) are usually the most useful.
 */

const DEFAULT_MAX_BYTES = 128 * 1024; // 128 KB
const HEAD_FRACTION = 0.3;

export interface TruncateOptions {
  maxBytes?: number;
  /** Short label for the inline marker, e.g. "stdout", "tool result". */
  label?: string;
  /**
   * One-line hint the model can act on (e.g. "Re-run with head/tail/grep").
   * Shown inside the inline marker and as a separate prefix line at the top
   * of the truncated string so it's hard to miss.
   */
  hint?: string;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export interface TruncationInfo {
  truncated: boolean;
  totalBytes: number;
  emittedBytes: number;
}

export function truncateString(
  input: string,
  opts: TruncateOptions = {},
): { content: string; info: TruncationInfo } {
  const max = opts.maxBytes ?? DEFAULT_MAX_BYTES;
  const label = opts.label ?? "output";
  if (input.length <= max) {
    return {
      content: input,
      info: { truncated: false, totalBytes: input.length, emittedBytes: input.length },
    };
  }
  const headLen = Math.floor(max * HEAD_FRACTION);
  const tailLen = max - headLen;
  const head = input.slice(0, headLen);
  const tail = input.slice(input.length - tailLen);
  const dropped = input.length - head.length - tail.length;
  const hintClause = opts.hint ? ` ${opts.hint}` : "";
  const inlineMarker = `\n... [${label} truncated: ${formatBytes(dropped)} omitted, ${formatBytes(input.length)} total.${hintClause}] ...\n`;
  const topBanner = `[TRUNCATED ${label}: ${formatBytes(input.length)} total, ${formatBytes(dropped)} dropped.${hintClause}]\n`;
  return {
    content: topBanner + head + inlineMarker + tail,
    info: {
      truncated: true,
      totalBytes: input.length,
      emittedBytes: head.length + tail.length,
    },
  };
}

/**
 * Serialize a tool result and cap its size. Falls back to a safe error string
 * if serialization itself fails (e.g. circular references — which have been
 * implicated in past OOMs).
 */
export function truncateToolResult(
  value: unknown,
  opts: TruncateOptions & { pretty?: boolean } = {},
): string {
  const pretty = opts.pretty ?? true;
  let serialized: string;
  try {
    serialized = pretty
      ? (JSON.stringify(value, null, 2) ?? "")
      : (JSON.stringify(value) ?? "");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return `ERROR: failed to serialize tool result (${msg})`;
  }
  return truncateString(serialized, {
    label: opts.label ?? "tool result",
    hint:
      opts.hint ??
      "The tool returned more data than fits in one message — ask the underlying tool for a narrower slice (pagination, a filter, a smaller range).",
    maxBytes: opts.maxBytes,
  }).content;
}
