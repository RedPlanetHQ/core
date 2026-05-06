/**
 * Filter library — v0.
 *
 * Filters are small pure functions applied via the pipe operator inside
 * expressions: `{{ value | filter:arg1:arg2 }}`. They take the piped value
 * plus zero or more arg strings (already trimmed by the parser) and return
 * a new value.
 *
 * Args arrive as strings — filters parse them as needed (e.g. `truncate:30`
 * parses "30" to a number internally).
 */

import type { Scope } from "./expression";

type FilterFn = (value: unknown, args: string[], scope: Scope) => unknown;

const filters: Record<string, FilterFn> = {
  /** "5 minutes ago" — accepts ISO string, Date, or epoch number. */
  timeAgo: (value) => {
    const date = toDate(value);
    if (!date) return "";
    const diff = Date.now() - date.getTime();
    return formatRelative(diff);
  },

  /** Formats a date. Default: "MMM d, yyyy". Pass an arg for an alternate format token. */
  formatDate: (value, args) => {
    const date = toDate(value);
    if (!date) return "";
    const fmt = args[0] ?? "short";
    return formatDate(date, fmt);
  },

  /** Returns the first arg if value is null/undefined/empty-string. */
  default: (value, args) => {
    if (value == null) return args[0] ?? "";
    if (typeof value === "string" && value.length === 0) return args[0] ?? "";
    return value;
  },

  /** Truncates a string to N chars + ellipsis. */
  truncate: (value, args) => {
    const n = parseInt(args[0] ?? "40", 10);
    const s = typeof value === "string" ? value : String(value ?? "");
    return s.length > n ? s.slice(0, n - 1) + "…" : s;
  },

  /**
   * Maps the input value to one of the listed pairs.
   * Syntax: `match:KEY1=VAL1,KEY2=VAL2,...`
   * Special keys: `default` (fallback), `_` (alias for default).
   * Used heavily for badge color: `{{ priority | match:P0=red,P1=orange,_=gray }}`
   */
  match: (value, args) => {
    const raw = args[0] ?? "";
    const pairs = raw.split(",").map((p) => p.trim()).filter(Boolean);
    let fallback = "";
    for (const pair of pairs) {
      const eqIdx = pair.indexOf("=");
      if (eqIdx < 0) continue;
      const key = pair.slice(0, eqIdx).trim();
      const val = pair.slice(eqIdx + 1).trim();
      if (key === "default" || key === "_") {
        fallback = val;
        continue;
      }
      if (String(value) === key) return val;
    }
    return fallback;
  },

  lower: (value) => String(value ?? "").toLowerCase(),
  upper: (value) => String(value ?? "").toUpperCase(),
  capitalize: (value) => {
    const s = String(value ?? "");
    return s.length === 0 ? s : s[0].toUpperCase() + s.slice(1);
  },

  not: (value) => !truthy(value),

  /** Equality test as a filter — useful for `where` predicates that don't fit raw `==`. */
  eq: (value, args, scope) => {
    const target = resolveArg(args[0], scope);
    return looseEquals(value, target);
  },

  /** Length of a string or array; 0 for null/undefined. */
  length: (value) => {
    if (value == null) return 0;
    if (Array.isArray(value)) return value.length;
    if (typeof value === "string") return value.length;
    return 0;
  },
};

/**
 * Apply a named filter. If the filter doesn't exist, returns the value
 * unchanged (graceful degradation — important since the agent may emit
 * filters we haven't shipped yet, and we don't want widgets to fail hard).
 */
export function applyFilter(
  name: string,
  value: unknown,
  args: string[],
  scope: Scope,
): unknown {
  const fn = filters[name];
  if (!fn) {
    if (typeof console !== "undefined") {
      console.warn(`[widget-runtime] unknown filter "${name}" — passing through`);
    }
    return value;
  }
  try {
    return fn(value, args, scope);
  } catch (err) {
    if (typeof console !== "undefined") {
      console.warn(`[widget-runtime] filter "${name}" threw`, err);
    }
    return value;
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function toDate(value: unknown): Date | null {
  if (value instanceof Date) return value;
  if (typeof value === "number") return new Date(value);
  if (typeof value === "string" && value.length > 0) {
    const d = new Date(value);
    return isNaN(d.getTime()) ? null : d;
  }
  return null;
}

function formatRelative(diffMs: number): string {
  const past = diffMs >= 0;
  const abs = Math.abs(diffMs);
  const sec = Math.floor(abs / 1000);
  const min = Math.floor(sec / 60);
  const hr = Math.floor(min / 60);
  const day = Math.floor(hr / 24);
  const month = Math.floor(day / 30);
  const year = Math.floor(day / 365);

  let out: string;
  if (sec < 30) out = "just now";
  else if (min < 1) out = `${sec}s`;
  else if (min < 60) out = `${min} min${min === 1 ? "" : "s"}`;
  else if (hr < 24) out = `${hr} hour${hr === 1 ? "" : "s"}`;
  else if (day < 30) out = `${day} day${day === 1 ? "" : "s"}`;
  else if (month < 12) out = `${month} month${month === 1 ? "" : "s"}`;
  else out = `${year} year${year === 1 ? "" : "s"}`;

  if (out === "just now") return out;
  return past ? `${out} ago` : `in ${out}`;
}

function formatDate(d: Date, fmt: string): string {
  const opts: Intl.DateTimeFormatOptions = (() => {
    switch (fmt) {
      case "short":
        return { month: "short", day: "numeric", year: "numeric" };
      case "long":
        return { weekday: "long", month: "long", day: "numeric", year: "numeric" };
      case "time":
        return { hour: "numeric", minute: "2-digit" };
      case "datetime":
        return {
          month: "short",
          day: "numeric",
          year: "numeric",
          hour: "numeric",
          minute: "2-digit",
        };
      case "iso":
        return {};
      default:
        return { month: "short", day: "numeric", year: "numeric" };
    }
  })();
  if (fmt === "iso") return d.toISOString();
  try {
    return d.toLocaleDateString(undefined, opts);
  } catch {
    return d.toISOString();
  }
}

function truthy(v: unknown): boolean {
  if (Array.isArray(v)) return v.length > 0;
  return Boolean(v);
}

function looseEquals(a: unknown, b: unknown): boolean {
  if (a == null && b == null) return true;
  return String(a) === String(b);
}

function resolveArg(arg: string | undefined, scope: Scope): unknown {
  if (!arg) return undefined;
  // String literal
  if (
    (arg.startsWith('"') && arg.endsWith('"')) ||
    (arg.startsWith("'") && arg.endsWith("'"))
  ) {
    return arg.slice(1, -1);
  }
  if (/^-?\d+(\.\d+)?$/.test(arg)) return Number(arg);
  if (arg === "true") return true;
  if (arg === "false") return false;
  if (arg === "null") return null;
  // Otherwise: path lookup
  const parts = arg.split(".");
  let cur: unknown = scope;
  for (const p of parts) {
    if (cur == null) return undefined;
    if (typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[p];
  }
  return cur;
}
