/**
 * Widget request orchestrator.
 *
 *   runWidgetRequests(widget, opts)
 *     → returns a map { requestId: result }, honoring the per-widget cache.
 *
 * Modes:
 *   - opts.requestIds undefined: run the full request graph (topo order),
 *     check whole-widget cache, write whole cache blob.
 *   - opts.requestIds = [id, ...]: per-request mode. Run ONLY those ids
 *     (caller is responsible for ensuring deps are resolved). Skip cache
 *     read for those ids. Merge results into the existing cache blob
 *     instead of replacing it.
 *
 * Mutation handling:
 *   Any request with `cache: { kind: "none" }` is treated as a mutation —
 *   always executes, never caches. This lets the IR distinguish reads from
 *   writes (create_issue, send_email, etc.) without a separate type.
 */

import { prisma } from "~/db.server";
import type { Prisma } from "@prisma/client";
import type { WidgetIR, WidgetRequest } from "@core/types";
import type { Scope } from "~/components/widgets/runtime/expression";
import { executeRequest } from "./executors";
import {
  computeExpiresAt,
  computeParamHash,
  inspectCache,
  type WidgetCacheBlob,
} from "./cache";
import { logger } from "~/services/logger.service";

export interface RunWidgetRequestsOptions {
  widgetId: string;
  workspaceId: string;
  userId: string;
  /** Force re-execution even if cache is fresh. */
  force?: boolean;
  /**
   * If provided, only execute these request ids. Caller ensures any
   * `$request.X` deps in their templates resolve from the existing cache.
   * Used by the runtime's `runRequest` action op for one-click mutations.
   */
  requestIds?: string[];
  /**
   * Action-payload scope forwarded from the dispatcher. Threaded into the
   * evaluator under `args` / `event` so request `params` like
   * `{{args.title}}` resolve against the originating Form/Button payload.
   * Only honored in targeted (per-request) mode — whole-graph runs don't
   * have a triggering action.
   */
  args?: Record<string, unknown>;
  event?: Record<string, unknown>;
  /**
   * Config overrides — merged on top of `ir.config[].default` before
   * evaluating templates. Set by the chat tag (`<core-widget config='…' />`)
   * or daily-grid layout config. Without this, requests templating against
   * `{{$config.*}}` would resolve to the IR defaults regardless of what the
   * user/agent passed in, and the rendered data wouldn't match the visible
   * config form.
   */
  configOverride?: Record<string, unknown>;
}

export interface RunWidgetRequestsResult {
  results: Record<string, unknown>;
  errors: Record<string, string>;
  cacheHit: boolean;
  cacheReason: "fresh" | "expired" | "param-changed" | "missing" | "force" | "targeted";
  /** ISO string of expiresAt, or null if no auto-expire / per-request mode. */
  expiresAt: string | null;
}

export async function runWidgetRequests(
  opts: RunWidgetRequestsOptions,
): Promise<RunWidgetRequestsResult> {
  const widget = await prisma.widget.findFirst({
    where: {
      id: opts.widgetId,
      workspaceId: opts.workspaceId,
      userId: opts.userId,
      kind: "USER",
      deleted: null,
    },
  });
  if (!widget) {
    throw new Error(`Widget ${opts.widgetId} not found for this user.`);
  }
  if (widget.engine !== "DECLARATIVE") {
    return {
      results: {},
      errors: {},
      cacheHit: false,
      cacheReason: "missing",
      expiresAt: null,
    };
  }

  const ir = widget.spec as unknown as WidgetIR | null;
  if (!ir || !ir.requests || ir.requests.length === 0) {
    return {
      results: {},
      errors: {},
      cacheHit: false,
      cacheReason: "missing",
      expiresAt: null,
    };
  }

  const config = (() => {
    const out: Record<string, unknown> = {};
    for (const f of ir.config ?? []) {
      out[f.id] = f.default ?? "";
    }
    if (opts.configOverride) {
      for (const [k, v] of Object.entries(opts.configOverride)) {
        if (v !== undefined) out[k] = v;
      }
    }
    return out;
  })();
  const state = (widget.state as Record<string, unknown> | null) ?? {};

  const paramHash = computeParamHash(ir, config, state);
  const now = new Date();

  const cacheBlob = widget.cache as WidgetCacheBlob | null;

  // ─── Per-request (targeted) mode ────────────────────────────────────────
  if (opts.requestIds && opts.requestIds.length > 0) {
    return runTargetedRequests({
      ir,
      config,
      state,
      cacheBlob,
      now,
      paramHash,
      widgetId: widget.id,
      workspaceId: opts.workspaceId,
      userId: opts.userId,
      targetIds: opts.requestIds,
      args: opts.args,
      event: opts.event,
    });
  }

  // ─── Whole-graph mode (existing behavior) ───────────────────────────────
  const inspect = inspectCache(cacheBlob, paramHash, now, opts.force);

  if (inspect.hit && inspect.results) {
    return {
      results: inspect.results,
      errors: {},
      cacheHit: true,
      cacheReason: "fresh",
      expiresAt: inspect.expiresAt ? inspect.expiresAt.toISOString() : null,
    };
  }

  const ordered = topoSortRequests(ir.requests);
  const results: Record<string, unknown> = {};
  const errors: Record<string, string> = {};

  if ("error" in ordered) {
    errors.__topology = ordered.error;
    return {
      results,
      errors,
      cacheHit: false,
      cacheReason: opts.force ? "force" : inspect.reason,
      expiresAt: null,
    };
  }

  // `internal` requests are mutations (create_task, delete_task, …) — never
  // run them as part of a whole-graph fetch, even if the IR forgot to set
  // `cache: { kind: "none" }`. They only fire via the `runRequest` action
  // op (targeted mode below).
  for (const request of ordered.requests.filter((r) => r.type !== "internal")) {
    const scope: Scope = {
      $config: config,
      $state: state,
      $request: results,
      $derived: {},
    };
    const out = await executeRequest(request, {
      workspaceId: opts.workspaceId,
      userId: opts.userId,
      scope,
    });
    if (out.ok) {
      results[request.id] = out.value;
    } else {
      errors[request.id] = out.error ?? "unknown error";
    }
  }

  // Cache write — exclude any results from `cache.kind === "none"` requests
  // (mutations shouldn't be cached).
  const cacheableResults = filterCacheable(results, ir.requests);
  const expiresAt = computeExpiresAt(ir.requests, now);

  // Merge with existing cache.results so other requests' values aren't
  // wiped if we're only re-running a subset (defensive — full graph runs
  // overwrite via cacheableResults anyway).
  const mergedResults: Record<string, unknown> = {
    ...((cacheBlob?.results as Record<string, unknown> | undefined) ?? {}),
    ...cacheableResults,
  };

  const blob: WidgetCacheBlob = {
    results: mergedResults,
    paramHash,
    lastPulled: now.toISOString(),
    expiresAt: expiresAt ? expiresAt.toISOString() : null,
  };

  try {
    await prisma.widget.update({
      where: { id: widget.id },
      data: { cache: blob as unknown as Prisma.InputJsonValue },
    });
  } catch (err) {
    logger.warn("widget cache write failed", { widgetId: widget.id, err });
  }

  return {
    results,
    errors,
    cacheHit: false,
    cacheReason: opts.force ? "force" : inspect.reason,
    expiresAt: expiresAt ? expiresAt.toISOString() : null,
  };
}

// ─── Targeted (per-request) mode ────────────────────────────────────────────

interface TargetedOpts {
  ir: WidgetIR;
  config: Record<string, unknown>;
  state: Record<string, unknown>;
  cacheBlob: WidgetCacheBlob | null;
  now: Date;
  paramHash: string;
  widgetId: string;
  workspaceId: string;
  userId: string;
  targetIds: string[];
  args?: Record<string, unknown>;
  event?: Record<string, unknown>;
}

async function runTargetedRequests(
  o: TargetedOpts,
): Promise<RunWidgetRequestsResult> {
  const requests = o.ir.requests ?? [];
  const byId = new Map(requests.map((r) => [r.id, r]));

  // Surface previously-cached results so templated $request.X references in
  // the targets resolve correctly.
  const existingResults =
    (o.cacheBlob?.results as Record<string, unknown> | undefined) ?? {};

  const results: Record<string, unknown> = { ...existingResults };
  const errors: Record<string, string> = {};

  for (const id of o.targetIds) {
    const request = byId.get(id);
    if (!request) {
      errors[id] = `request "${id}" not found in widget IR`;
      continue;
    }
    const scope: Scope = {
      $config: o.config,
      $state: o.state,
      $request: results,
      $derived: {},
      args: o.args ?? {},
      event: o.event ?? {},
    };
    const out = await executeRequest(request, {
      workspaceId: o.workspaceId,
      userId: o.userId,
      scope,
    });
    if (out.ok) {
      results[request.id] = out.value;
    } else {
      errors[request.id] = out.error ?? "unknown error";
    }
  }

  // Cache merge: only write back NON-mutation results. Mutations (cache.kind
  // === "none") never poison the cache.
  const targetedResults = Object.fromEntries(
    o.targetIds.map((id) => [id, results[id]]).filter(([, v]) => v !== undefined),
  );
  const cacheableTargets = filterCacheable(targetedResults, requests);

  const mergedResults = { ...existingResults, ...cacheableTargets };
  const expiresAt = computeExpiresAt(requests, o.now);

  const blob: WidgetCacheBlob = {
    results: mergedResults,
    paramHash: o.paramHash,
    lastPulled: o.now.toISOString(),
    expiresAt: expiresAt ? expiresAt.toISOString() : null,
  };

  try {
    await prisma.widget.update({
      where: { id: o.widgetId },
      data: { cache: blob as unknown as Prisma.InputJsonValue },
    });
  } catch (err) {
    logger.warn("widget cache merge failed", { widgetId: o.widgetId, err });
  }

  return {
    // Return the full results map so the runtime can update store with
    // dependencies the targeted request implicitly needed.
    results,
    errors,
    cacheHit: false,
    cacheReason: "targeted",
    expiresAt: expiresAt ? expiresAt.toISOString() : null,
  };
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Drop entries that must never be cached:
 *   - any request with `cache: { kind: "none" }` (explicit opt-out)
 *   - any `internal` request (mutations — `create_task` etc. — are
 *     side-effecting; caching them would replay the side effect on rehydrate
 *     or, worse, hide a real mutation behind a stale "ok" result).
 */
function filterCacheable(
  results: Record<string, unknown>,
  requests: WidgetRequest[],
): Record<string, unknown> {
  const noCache = new Set(
    requests
      .filter((r) => {
        if (r.type === "internal") return true;
        const cache = (r as { cache?: { kind?: string } }).cache;
        return cache?.kind === "none";
      })
      .map((r) => r.id),
  );
  if (noCache.size === 0) return results;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(results)) {
    if (!noCache.has(k)) out[k] = v;
  }
  return out;
}

// ─── Topological sort ───────────────────────────────────────────────────────

function topoSortRequests(
  requests: WidgetRequest[],
):
  | { requests: WidgetRequest[] }
  | { error: string } {
  const REQUEST_REF_RE = /\{\{\s*\$request\.([a-zA-Z][\w-]*)/g;

  const byId = new Map<string, WidgetRequest>();
  for (const r of requests) byId.set(r.id, r);

  const deps = new Map<string, Set<string>>();
  for (const r of requests) {
    const dependsOn = new Set<string>();
    const text = JSON.stringify(r);
    let m;
    while ((m = REQUEST_REF_RE.exec(text)) !== null) {
      const refId = m[1];
      if (refId !== r.id && byId.has(refId)) dependsOn.add(refId);
    }
    REQUEST_REF_RE.lastIndex = 0;
    deps.set(r.id, dependsOn);
  }

  const sorted: WidgetRequest[] = [];
  const visited = new Set<string>();
  const onStack = new Set<string>();
  let cycleError: string | null = null;

  const visit = (id: string) => {
    if (cycleError) return;
    if (visited.has(id)) return;
    if (onStack.has(id)) {
      cycleError = `Cyclic dependency: "${id}" is part of a cycle`;
      return;
    }
    onStack.add(id);
    for (const dep of deps.get(id) ?? []) visit(dep);
    onStack.delete(id);
    visited.add(id);
    const r = byId.get(id);
    if (r) sorted.push(r);
  };

  for (const r of requests) visit(r.id);
  if (cycleError) return { error: cycleError };
  return { requests: sorted };
}
