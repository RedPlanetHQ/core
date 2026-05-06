/**
 * WidgetRuntime — top-level orchestrator for v0.
 *
 * Wraps a widget IR in:
 *   - a `WidgetStore` (state, requests, derived)
 *   - a RuntimeProvider so block renderers can read/dispatch
 *   - the block-tree render
 *   - an optional persistence hook for `state[].persist: true` fields
 *
 * Persistence: pass `onStatePersist` to opt in. The runtime debounces by
 * ~600ms after each commit and invokes the callback with only the persisted
 * subset of state. Pass undefined for DEFAULT widgets / previews.
 */

import { useEffect, useMemo, useRef } from "react";
import type { WidgetIR } from "@core/types";
import { WidgetStore } from "./store";
import { RuntimeProvider } from "./context";
import { BlockRenderer } from "./blocks";

export interface WidgetRuntimeProps {
  ir: WidgetIR;
  initialState?: Record<string, unknown>;
  initialConfig?: Record<string, unknown>;
  /** Called with persisted state after debounce. Pass undefined to disable. */
  onStatePersist?: (state: Record<string, unknown>) => void;
}

const PERSIST_DEBOUNCE_MS = 600;

export function WidgetRuntime({
  ir,
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

  const persistedKeys = useMemo(
    () => (ir.state ?? []).filter((s) => s.persist).map((s) => s.id),
    [ir],
  );

  // Debounced state persistence — subscribes to the store, extracts the
  // persisted-state subset on each commit, and POSTs after the debounce
  // window. Skips initial mount commit (the snapshot equals what we just
  // hydrated from the server, no point round-tripping it).
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

    // Seed lastPersisted with the initial snapshot so the first commit is
    // only persisted if it actually changes from what we hydrated with.
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
          // Caller's handler is responsible for surfacing errors. The runtime
          // doesn't crash on a failed persist — the user keeps editing.
        }
      }, PERSIST_DEBOUNCE_MS);
    });

    return () => {
      if (timer) clearTimeout(timer);
      unsubscribe();
    };
  }, [store, onStatePersist, persistedKeys]);

  return (
    <RuntimeProvider store={store} ir={ir} widgetId={ir.id}>
      <div className="space-y-2">
        {ir.blocks.map((block, i) => (
          <BlockRenderer key={i} block={block} />
        ))}
      </div>
    </RuntimeProvider>
  );
}
