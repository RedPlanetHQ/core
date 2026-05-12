/**
 * RuntimeContext + hooks — the React glue for the widget store.
 *
 * Block renderers call `useRuntime()` to read the snapshot reactively and
 * `useDispatch()` to fire actions. Local scopes (item, args, event) are
 * passed via a separate `ScopeContext` because they're per-render, not per
 * store.
 */

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import type { WidgetIR } from "@core/types";
import { evaluateValue, type Scope } from "./expression";
import type { WidgetStore, Snapshot } from "./store";
import { dispatchAction } from "./actions";

interface RuntimeValue {
  store: WidgetStore;
  ir: WidgetIR;
  /** Widget id (slug) — handy for keying persistence calls. */
  widgetId: string;
  /**
   * Optional async refresher. With requestId: per-request mutation pattern
   * (force-execute that one request, bypass cache). Without: refresh the
   * whole graph honoring cache. Called by the action dispatcher's
   * `runRequest` op. `extra` carries the dispatcher's args/event so request
   * `params` templated against `{{args.*}}` / `{{event.*}}` resolve
   * server-side.
   */
  runRequests?: (
    requestId?: string,
    extra?: { args?: Record<string, unknown>; event?: Record<string, unknown> },
  ) => Promise<void>;
}

const RuntimeCtx = createContext<RuntimeValue | null>(null);
const ScopeCtx = createContext<Scope>({});

export function RuntimeProvider({
  store,
  ir,
  widgetId,
  runRequests,
  children,
}: {
  store: WidgetStore;
  ir: WidgetIR;
  widgetId: string;
  runRequests?: (
    requestId?: string,
    extra?: { args?: Record<string, unknown>; event?: Record<string, unknown> },
  ) => Promise<void>;
  children: ReactNode;
}) {
  const value = useMemo(
    () => ({ store, ir, widgetId, runRequests }),
    [store, ir, widgetId, runRequests],
  );
  return <RuntimeCtx.Provider value={value}>{children}</RuntimeCtx.Provider>;
}

/** Push extra scope (item/args/event) for nested blocks. Merges with parent. */
export function ScopeProvider({
  extra,
  children,
}: {
  extra: Scope;
  children: ReactNode;
}) {
  const parent = useContext(ScopeCtx);
  const merged = useMemo(() => ({ ...parent, ...extra }), [parent, extra]);
  return <ScopeCtx.Provider value={merged}>{children}</ScopeCtx.Provider>;
}

export function useRuntime(): RuntimeValue {
  const ctx = useContext(RuntimeCtx);
  if (!ctx) {
    throw new Error("useRuntime called outside <RuntimeProvider>");
  }
  return ctx;
}

/** Reactive snapshot — re-renders when the store commits. */
export function useSnapshot(): Snapshot {
  const { store } = useRuntime();
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}

export function useScope(): Scope {
  return useContext(ScopeCtx);
}

/**
 * Resolve any expression-bearing value against the current snapshot + local
 * scope. Re-evaluates on snapshot change because `useSnapshot` is reactive.
 */
export function useEvaluate(expr: unknown, extra: Scope = {}): unknown {
  const { store } = useRuntime();
  useSnapshot(); // subscribe — drives re-render on state change
  const localScope = useScope();
  return store.evaluate(expr, { ...localScope, ...extra });
}

/**
 * Single hook bundling everything an interactive block needs to fire an
 * action: store + ir + scope + arg evaluation, all wired up. Returns a
 * `dispatch` function:
 *
 *     const dispatch = useDispatch();
 *     dispatch(actionId, { args: block.args, event: { values: ... } });
 *
 * `args` is optional and can hold templated values — the hook evaluates
 * them against the merged store + local scope before forwarding.
 */
export function useDispatch() {
  const { store, ir, runRequests } = useRuntime();
  const localScope = useScope();

  return useCallback(
    (
      actionId: string | undefined,
      payload?: {
        args?: Record<string, unknown>;
        event?: Record<string, unknown>;
      },
    ) => {
      if (!actionId) return;
      const evaluatedArgs = payload?.args
        ? (evaluateValue(payload.args, {
            ...store.scope(),
            ...localScope,
          }) as Record<string, unknown>)
        : undefined;
      dispatchAction(actionId, {
        store,
        ir,
        args: evaluatedArgs,
        event: payload?.event,
        runRequests,
      });
    },
    [store, ir, localScope, runRequests],
  );
}
