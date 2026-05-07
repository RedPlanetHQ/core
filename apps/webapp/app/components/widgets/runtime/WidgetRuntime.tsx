/**
 * WidgetRuntime — top-level orchestrator.
 *
 * Wraps a widget IR in:
 *   - a `WidgetStore` (state, requests, derived)
 *   - a RuntimeProvider so block renderers can read/dispatch
 *   - the block-tree render
 *   - optional persistence hook for `state[].persist: true` fields
 *   - optional server-side request executor (v1.1+) for ai.* /
 *     integration_action / static requests
 *
 * Server-side request execution kicks in when `widgetUuid` is provided. On
 * mount, the runtime calls `GET /api/v1/widgets/<uuid>/requests`, parses the
 * results, and pushes them into the store. The `runRequest` action op
 * triggers a force-refresh POST to the same path.
 *
 * For previews / DEFAULT widgets / IRs without server-resolvable requests,
 * pass `widgetUuid={undefined}` and the runtime skips the fetch — requests
 * stay in their `__pending` placeholder shape (same as v0).
 */

import { useCallback, useEffect, useMemo, useRef } from "react";
import type { WidgetIR } from "@core/types";
import { WidgetStore } from "./store";
import { RuntimeProvider } from "./context";
import { BlockRenderer } from "./blocks";
import { getTickIntervalMs } from "./expression";

export interface WidgetRuntimeProps {
  ir: WidgetIR;
  /** UUID of the persisted Widget row — required for server-side request execution. */
  widgetUuid?: string;
  initialState?: Record<string, unknown>;
  initialConfig?: Record<string, unknown>;
  /** Called with persisted state after debounce. Pass undefined to disable. */
  onStatePersist?: (state: Record<string, unknown>) => void;
}

const PERSIST_DEBOUNCE_MS = 600;

export function WidgetRuntime({
  ir,
  widgetUuid,
  initialState,
  initialConfig,
  onStatePersist,
}: WidgetRuntimeProps) {
  const store = useMemo(
    () =>
      new WidgetStore(ir, {
        initialState: initialState ?? undefined,
        initialConfig: initialConfig ?? undefined,
      }),
    // Recreate store on IR object identity change. Cheap — widgets remount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ir],
  );

  // ─── State persistence (unchanged from v0) ───────────────────────────────
  const persistedKeys = useMemo(
    () => (ir.state ?? []).filter((s) => s.persist).map((s) => s.id),
    [ir],
  );

  const initialSnapshotRef = useRef(store.getSnapshot());
  const lastPersistedRef = useRef<string>("");

  useEffect(() => {
    if (!onStatePersist || persistedKeys.length === 0) return;

    let timer: ReturnType<typeof setTimeout> | null = null;

    const computeSubset = (
      state: Record<string, unknown>,
    ): Record<string, unknown> => {
      const out: Record<string, unknown> = {};
      for (const key of persistedKeys) {
        if (key in state) out[key] = state[key];
      }
      return out;
    };

    lastPersistedRef.current = JSON.stringify(
      computeSubset(initialSnapshotRef.current.state),
    );

    const unsubscribe = store.subscribe(() => {
      const snap = store.getSnapshot();
      const subset = computeSubset(snap.state);
      const serialized = JSON.stringify(subset);
      if (serialized === lastPersistedRef.current) return;

      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        lastPersistedRef.current = serialized;
        try {
          onStatePersist(subset);
        } catch {
          /* caller's handler is responsible for surfacing errors */
        }
      }, PERSIST_DEBOUNCE_MS);
    });

    return () => {
      if (timer) clearTimeout(timer);
      unsubscribe();
    };
  }, [store, onStatePersist, persistedKeys]);

  // ─── now ticker — auto-derived cadence for widgets that reference `{{now}}` ──
  // 1s for countdowns / mmss / numeric comparisons; 60s when the IR only
  // uses minute-precision filters (timeAgo, formatDate, formatDuration).
  const tickIntervalMs = useMemo(() => getTickIntervalMs(ir), [ir]);

  useEffect(() => {
    if (tickIntervalMs == null) return;
    const id = setInterval(() => store.tick(), tickIntervalMs);
    return () => clearInterval(id);
  }, [tickIntervalMs, store]);

  // ─── Server-side request execution (v1.1+) ───────────────────────────────

  const hasNonStaticRequests = useMemo(
    () => (ir.requests ?? []).some((r) => r.type !== "static"),
    [ir],
  );

  /**
   * Run requests on the server and push results into the store.
   *
   *   runRequests()              — full graph, honors cache (initial mount)
   *   runRequests(undefined,true) — full graph, bypasses cache
   *   runRequests("send_email")  — per-request mutation; bypasses cache
   *
   * The action dispatcher's `runRequest` op calls this with a specific
   * request id, awaiting the promise so subsequent ops see the new state.
   */
  const runRequests = useCallback(
    async (
      requestId?: string,
      opts?: {
        forceFullGraph?: boolean;
        args?: Record<string, unknown>;
        event?: Record<string, unknown>;
      },
    ): Promise<void> => {
      if (!widgetUuid || !hasNonStaticRequests) return;
      try {
        const url = `/api/v1/widgets/${encodeURIComponent(widgetUuid)}/requests`;
        // POST always (so we can carry config/args/event in the body). GET
        // path was the cache-honoring read; we now express that with
        // force:false instead, since config overrides only travel via body.
        const isMutation = requestId !== undefined;
        const force = opts?.forceFullGraph || isMutation;
        const res = await fetch(url, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            force,
            ...(requestId ? { requestIds: [requestId] } : {}),
            ...(initialConfig ? { config: initialConfig } : {}),
            ...(opts?.args ? { args: opts.args } : {}),
            ...(opts?.event ? { event: opts.event } : {}),
          }),
        });
        if (!res.ok) return;
        const data = (await res.json()) as {
          results?: Record<string, unknown>;
          errors?: Record<string, string>;
        };
        const results = data.results ?? {};
        for (const [id, value] of Object.entries(results)) {
          store.setRequestResult(id, value);
        }
      } catch {
        /* network / parse errors degrade gracefully — placeholder stays */
      }
    },
    [widgetUuid, hasNonStaticRequests, store, initialConfig],
  );

  // Initial fetch on mount (and whenever widgetUuid changes). Full graph,
  // cache-honoring.
  useEffect(() => {
    if (!widgetUuid || !hasNonStaticRequests) return;
    let cancelled = false;
    (async () => {
      if (cancelled) return;
      await runRequests();
    })();
    return () => {
      cancelled = true;
    };
  }, [widgetUuid, hasNonStaticRequests, runRequests]);

  // Per-request interval refresh — any request declaring
  // `refresh: { kind: "interval", intervalMs: N }` gets its own ticker that
  // re-executes that request every N ms (force-fetch, bypassing cache).
  // Multiple interval requests are independent; each gets its own timer.
  const intervalRequests = useMemo(
    () =>
      (ir.requests ?? [])
        .map((r) => {
          const refresh = (r as { refresh?: { kind?: string; intervalMs?: number } }).refresh;
          if (refresh?.kind !== "interval" || !refresh.intervalMs) return null;
          return { id: r.id, intervalMs: refresh.intervalMs };
        })
        .filter((x): x is { id: string; intervalMs: number } => x !== null),
    [ir],
  );

  useEffect(() => {
    if (!widgetUuid || intervalRequests.length === 0) return;
    const timers = intervalRequests.map(({ id, intervalMs }) =>
      setInterval(() => {
        void runRequests(id);
      }, intervalMs),
    );
    return () => {
      for (const t of timers) clearInterval(t);
    };
  }, [widgetUuid, intervalRequests, runRequests]);

  // Adapter for the dispatcher: receives an optional requestId from the
  // `runRequest` op and forwards. Undefined → refresh whole graph (force).
  // `extra` carries args/event from the action payload so request `params`
  // templated against `{{args.*}}` / `{{event.*}}` resolve server-side.
  const triggerRunRequests = useCallback(
    (
      requestId?: string,
      extra?: {
        args?: Record<string, unknown>;
        event?: Record<string, unknown>;
      },
    ) =>
      requestId
        ? runRequests(requestId, { args: extra?.args, event: extra?.event })
        : runRequests(undefined, {
            forceFullGraph: true,
            args: extra?.args,
            event: extra?.event,
          }),
    [runRequests],
  );

  return (
    <RuntimeProvider
      store={store}
      ir={ir}
      widgetId={ir.id}
      runRequests={widgetUuid && hasNonStaticRequests ? triggerRunRequests : undefined}
    >
      <div className="space-y-2">
        {ir.blocks.map((block, i) => (
          <BlockRenderer key={i} block={block} />
        ))}
      </div>
    </RuntimeProvider>
  );
}
