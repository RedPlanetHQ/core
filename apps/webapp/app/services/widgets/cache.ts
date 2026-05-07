/**
 * Per-widget request cache helpers.
 *
 * Cache shape on the Widget row (`Widget.cache` JSON column):
 *
 *   {
 *     "results":   { "<requestId>": <value> },
 *     "paramHash": "<sha256 of resolved inputs>",
 *     "lastPulled": "2026-05-06T12:00:00Z",
 *     "expiresAt":  "2026-05-06T13:00:00Z"  // null = never auto-expire
 *   }
 *
 * paramHash includes:
 *   - the IR's requests definition (so prompt/param changes invalidate)
 *   - the full $config map
 *   - only the $state fields actually referenced by any request (so unrelated
 *     state changes — like typing in a form — don't blow the cache)
 *
 * expiresAt is computed from the most-restrictive cache policy across all
 * requests in the widget. v1.1 collapses per-request granularity to a single
 * widget-level expiry — see the design note in widget.server.ts.
 */

import { createHash } from "node:crypto";
import type { WidgetIR, WidgetRequest, CachePolicy } from "@core/types";

export interface WidgetCacheBlob {
  results: Record<string, unknown>;
  paramHash: string;
  lastPulled: string;
  expiresAt: string | null;
}

// ─── Hashing ────────────────────────────────────────────────────────────────

/** Stable JSON stringify with sorted keys — same input always hashes the same. */
function stableStringify(value: unknown): string {
  if (value == null) return "null";
  if (typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return "[" + value.map(stableStringify).join(",") + "]";
  }
  const keys = Object.keys(value as Record<string, unknown>).sort();
  const parts = keys.map(
    (k) => JSON.stringify(k) + ":" + stableStringify((value as Record<string, unknown>)[k]),
  );
  return "{" + parts.join(",") + "}";
}

/** Find every `$state.<id>` reference inside a request's templated fields. */
const STATE_REF_RE = /\{\{\s*\$state\.([a-zA-Z][\w-]*)/g;

export function collectStateRefs(requests: WidgetRequest[]): Set<string> {
  const refs = new Set<string>();
  for (const r of requests) {
    const text = JSON.stringify(r);
    let m;
    while ((m = STATE_REF_RE.exec(text)) !== null) {
      refs.add(m[1]);
    }
    STATE_REF_RE.lastIndex = 0;
  }
  return refs;
}

/**
 * Compute the cache key for the current render context.
 * Different IR / config / referenced-state subset → different hash → cache miss.
 */
export function computeParamHash(
  ir: WidgetIR,
  config: Record<string, unknown>,
  state: Record<string, unknown>,
): string {
  const requests = ir.requests ?? [];
  const referencedKeys = collectStateRefs(requests);
  const stateSubset: Record<string, unknown> = {};
  for (const k of referencedKeys) {
    if (k in state) stateSubset[k] = state[k];
  }

  const payload = {
    // Hash the requests array — any change to prompt/params/etc. invalidates.
    requests,
    config,
    state: stateSubset,
  };

  return createHash("sha256").update(stableStringify(payload)).digest("hex");
}

// ─── Expiry ─────────────────────────────────────────────────────────────────

/**
 * Compute when the cache should expire given the request policies. The
 * widget-level expiry is the earliest TTL (or cron) across all
 * **cacheable** requests. Mutations (`cache: { kind: "none" }`,
 * `type: "internal"`) are ignored here — `filterCacheable` already drops
 * their results from the stored blob, so their non-policy doesn't need to
 * poison the read-cache window. Without this, a widget that mixes a
 * cached read and a mutation in the same IR (e.g. `important-things` with
 * `items` + `deleteTaskReq`) would expire immediately every time and
 * never serve a cache hit.
 *
 * Returns:
 *   - earliest ttl/cron expiry across cacheable requests, OR
 *   - null when no cacheable request declares a policy (= never auto-expire)
 */
export function computeExpiresAt(
  requests: WidgetRequest[],
  computedAt: Date,
): Date | null {
  if (requests.length === 0) return null;

  let earliest: Date | null = null;
  let anyHasPolicy = false;

  for (const r of requests) {
    // Skip non-cacheable requests entirely. Their policies (kind: none) and
    // implicit non-cacheability (type: internal) shouldn't gate the
    // remaining cacheable reads.
    if (r.type === "internal") continue;
    const policy = (r as { cache?: CachePolicy }).cache;
    if (!policy || policy.kind === "none") continue;

    anyHasPolicy = true;
    let next: Date;
    if (policy.kind === "ttl") {
      next = new Date(computedAt.getTime() + policy.ttlSeconds * 1000);
    } else if (policy.kind === "cron") {
      // TODO(v1.x): real cron parsing. For now: 24h fallback covers the
      // common "0 6 * * *" daily case acceptably.
      next = new Date(computedAt.getTime() + 24 * 60 * 60 * 1000);
    } else {
      continue;
    }
    if (earliest == null || next < earliest) earliest = next;
  }

  if (!anyHasPolicy) return null;
  return earliest;
}

// ─── Read ──────────────────────────────────────────────────────────────────

export interface CacheReadResult {
  hit: boolean;
  results: Record<string, unknown> | null;
  expiresAt: Date | null;
  reason: "fresh" | "expired" | "param-changed" | "missing";
}

/**
 * Inspect a stored cache blob against the current render context.
 * `forceRefresh` always returns a miss without reading.
 */
export function inspectCache(
  blob: WidgetCacheBlob | null | undefined,
  currentParamHash: string,
  now: Date,
  forceRefresh = false,
): CacheReadResult {
  if (forceRefresh) {
    return { hit: false, results: null, expiresAt: null, reason: "missing" };
  }
  if (!blob || !blob.results) {
    return { hit: false, results: null, expiresAt: null, reason: "missing" };
  }
  if (blob.paramHash !== currentParamHash) {
    return {
      hit: false,
      results: null,
      expiresAt: blob.expiresAt ? new Date(blob.expiresAt) : null,
      reason: "param-changed",
    };
  }
  if (blob.expiresAt) {
    const exp = new Date(blob.expiresAt);
    if (now >= exp) {
      return { hit: false, results: null, expiresAt: exp, reason: "expired" };
    }
    return { hit: true, results: blob.results, expiresAt: exp, reason: "fresh" };
  }
  // No expiresAt = never auto-expire (manual refresh only).
  return { hit: true, results: blob.results, expiresAt: null, reason: "fresh" };
}

// ─── Write ──────────────────────────────────────────────────────────────────

export function buildCacheBlob(
  results: Record<string, unknown>,
  paramHash: string,
  computedAt: Date,
  expiresAt: Date | null,
): WidgetCacheBlob {
  return {
    results,
    paramHash,
    lastPulled: computedAt.toISOString(),
    expiresAt: expiresAt ? expiresAt.toISOString() : null,
  };
}
