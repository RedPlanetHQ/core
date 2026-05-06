/**
 * Expression evaluator — v0.
 *
 * Supports the minimal grammar widget IRs need:
 *
 *   {{ path.to.value }}                  bare path access
 *   {{ "string" }} {{ 42 }} {{ true }}   literals
 *   {{ a == b }} {{ a != b }}            equality
 *   {{ !expr }}                          logical not
 *   {{ expr | filter:arg1:arg2 }}        filter pipeline
 *   {{ expr | f1 | f2 }}                 chained filters
 *
 * NOT supported (deliberately, for v0):
 *   - arithmetic, comparison operators (<, >, <=, >=)
 *   - logical &&/||
 *   - function calls beyond the filter pipeline
 *   - object literals, array literals
 *
 * The full template string may have multiple `{{ }}` interpolations mixed
 * with literal text. `evaluateTemplate` returns a string by stringifying
 * each interpolated value. Use `evaluate` for a single expression that
 * needs to keep its native type (boolean, array, etc.) — e.g. `Modal.open`
 * or `List.data`.
 */

import { applyFilter } from "./filters";

// ─── Public API ──────────────────────────────────────────────────────────────

/** Resolves a single expression, preserving its native type. */
export function evaluate(expr: string, scope: Scope): unknown {
  if (typeof expr !== "string") return expr;
  // If the expression is a pure interpolation `{{ … }}` with no surrounding
  // text, evaluate it directly so callers get a typed value back.
  const trimmed = expr.trim();
  const m = trimmed.match(/^\{\{([\s\S]+)\}\}$/);
  if (m) {
    return evaluateInner(m[1].trim(), scope);
  }
  // Mixed text + interpolations — stringify.
  return evaluateTemplate(expr, scope);
}

/** Resolves a template string (may contain literal text + `{{ … }}`). Always returns a string. */
export function evaluateTemplate(template: string, scope: Scope): string {
  if (typeof template !== "string") return String(template ?? "");
  return template.replace(/\{\{([\s\S]+?)\}\}/g, (_, inner) => {
    try {
      const value = evaluateInner(inner.trim(), scope);
      return stringify(value);
    } catch (err) {
      return `[err: ${(err as Error).message}]`;
    }
  });
}

/** Recursively evaluate a value tree (object/array/string), interpolating any string members. */
export function evaluateValue(value: unknown, scope: Scope): unknown {
  if (typeof value === "string") return evaluate(value, scope);
  if (Array.isArray(value)) return value.map((v) => evaluateValue(v, scope));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = evaluateValue(v, scope);
    }
    return out;
  }
  return value;
}

// ─── Scope ──────────────────────────────────────────────────────────────────

/**
 * The scope is a flat record. Reserved roots:
 *   $state    — declared state values
 *   $request  — request results
 *   $derived  — computed expressions
 *   $config   — config field values
 *
 * Plus loop-local roots set by callers:
 *   item, index   — inside List item templates
 *   args          — inline action args from the block
 *   event         — runtime event payload (form values, etc.)
 *   form          — form values when an action runs from a Form submit
 */
export type Scope = Record<string, unknown>;

// ─── Internals ──────────────────────────────────────────────────────────────

function evaluateInner(expr: string, scope: Scope): unknown {
  // Filter pipeline split on top-level `|` (not inside quoted strings).
  const segments = splitTopLevel(expr, "|");
  let value = evaluateOperand(segments[0].trim(), scope);
  for (let i = 1; i < segments.length; i++) {
    value = applyFilterSegment(value, segments[i].trim(), scope);
  }
  return value;
}

function applyFilterSegment(value: unknown, segment: string, scope: Scope): unknown {
  // segment shape: name(:arg)*
  // Args are the tail after the first colon, then split on top-level `:`.
  const colonIdx = segment.indexOf(":");
  if (colonIdx < 0) {
    return applyFilter(segment, value, [], scope);
  }
  const name = segment.slice(0, colonIdx).trim();
  const tail = segment.slice(colonIdx + 1);
  // For most filters, args are colon-separated. The `match` filter wants the
  // entire tail as one arg ("P0=red,P1=orange") so it can parse pairs itself.
  const args =
    name === "match" ? [tail.trim()] : splitTopLevel(tail, ":").map((a) => a.trim());
  return applyFilter(name, value, args, scope);
}

function evaluateOperand(expr: string, scope: Scope): unknown {
  expr = expr.trim();
  if (expr.length === 0) return undefined;

  // Logical not
  if (expr.startsWith("!")) {
    const inner = evaluateOperand(expr.slice(1), scope);
    return !truthy(inner);
  }

  // Equality / inequality — naive top-level scan
  for (const op of ["==", "!="]) {
    const idx = findTopLevel(expr, op);
    if (idx > 0) {
      const left = evaluateOperand(expr.slice(0, idx).trim(), scope);
      const right = evaluateOperand(expr.slice(idx + op.length).trim(), scope);
      const eq = looseEquals(left, right);
      return op === "==" ? eq : !eq;
    }
  }

  // Literal string (single or double quoted)
  if (
    (expr.startsWith('"') && expr.endsWith('"')) ||
    (expr.startsWith("'") && expr.endsWith("'"))
  ) {
    return expr.slice(1, -1);
  }

  // Number
  if (/^-?\d+(\.\d+)?$/.test(expr)) return Number(expr);

  // Boolean / null
  if (expr === "true") return true;
  if (expr === "false") return false;
  if (expr === "null") return null;
  if (expr === "undefined") return undefined;

  // Path: ident(.ident)*
  return resolvePath(expr, scope);
}

function resolvePath(path: string, scope: Scope): unknown {
  const parts = path.split(".");
  let cur: unknown = scope;
  for (const part of parts) {
    if (cur == null) return undefined;
    if (typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Truthiness for our DSL: same as JS but treats empty string and 0 as falsy. */
export function truthy(v: unknown): boolean {
  if (Array.isArray(v)) return v.length > 0;
  return Boolean(v);
}

function looseEquals(a: unknown, b: unknown): boolean {
  if (a == null && b == null) return true;
  // Coerce numeric strings → numbers for comparison.
  if (typeof a === "number" && typeof b === "string" && /^-?\d+(\.\d+)?$/.test(b))
    return a === Number(b);
  if (typeof b === "number" && typeof a === "string" && /^-?\d+(\.\d+)?$/.test(a))
    return Number(a) === b;
  return a === b;
}

/** Split on a separator only when not inside quotes. */
function splitTopLevel(s: string, sep: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let inQuote: '"' | "'" | null = null;
  let buf = "";
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inQuote) {
      buf += ch;
      if (ch === inQuote) inQuote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      inQuote = ch;
      buf += ch;
      continue;
    }
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (depth === 0 && s.slice(i, i + sep.length) === sep) {
      parts.push(buf);
      buf = "";
      i += sep.length - 1;
      continue;
    }
    buf += ch;
  }
  parts.push(buf);
  return parts;
}

function findTopLevel(s: string, op: string): number {
  let inQuote: '"' | "'" | null = null;
  for (let i = 0; i < s.length - op.length + 1; i++) {
    const ch = s[i];
    if (inQuote) {
      if (ch === inQuote) inQuote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      inQuote = ch;
      continue;
    }
    if (s.slice(i, i + op.length) === op) {
      // Skip `==` matching inside a longer operator (none currently, but
      // protects against future `===` introduction).
      if (op === "==" && s[i + 2] === "=") continue;
      if (op === "!=" && s[i + 2] === "=") continue;
      return i;
    }
  }
  return -1;
}

function stringify(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}
