/**
 * Reactive store — v0.
 *
 * Per-widget store holding `state`, `request` results, and computed
 * `derived` values. Subscribed via React's `useSyncExternalStore`.
 *
 * v0 scope:
 *   - state    — declared StateDecl values, mutable via actions
 *   - requests — only `static` requests are pre-evaluated. `ai.text`,
 *                `ai.structured`, `integration_action` are stored as `null`
 *                with a stub message until v1.1 ships request execution.
 *   - derived  — recomputed lazily after every state change
 *   - config   — captured at mount, not mutable from inside the widget
 *
 * The store is NOT memoized across widget remounts. Each `<WidgetRuntime>`
 * mount creates its own instance — fine since widgets are isolated and
 * cheap to recreate.
 */

import type { WidgetIR } from "@core/types";
import { evaluate, type Scope } from "./expression";

export type Listener = () => void;

export interface Snapshot {
  state: Record<string, unknown>;
  requests: Record<string, unknown>;
  derived: Record<string, unknown>;
  config: Record<string, unknown>;
  /** Modal block ids whose `open` state should be respected by the renderer. */
  modals: Record<string, boolean>;
}

export class WidgetStore {
  private listeners = new Set<Listener>();
  private snap: Snapshot;
  private ir: WidgetIR;

  constructor(ir: WidgetIR, opts: { initialConfig?: Record<string, unknown>; initialState?: Record<string, unknown> } = {}) {
    this.ir = ir;
    const stateDefaults: Record<string, unknown> = {};
    for (const decl of ir.state ?? []) {
      stateDefaults[decl.id] = opts.initialState?.[decl.id] ?? decl.default ?? defaultForType(decl.type);
    }

    const configDefaults: Record<string, unknown> = {};
    for (const f of ir.config ?? []) {
      configDefaults[f.id] = opts.initialConfig?.[f.id] ?? f.default ?? "";
    }

    const requests: Record<string, unknown> = {};
    for (const r of ir.requests ?? []) {
      if (r.type === "static") {
        requests[r.id] = (r as { value: unknown }).value;
      } else {
        // v0: AI + integration requests are not executed. Surface a sentinel
        // so block renderers can show a placeholder rather than crashing on
        // undefined data.
        requests[r.id] = { __pending: true, type: r.type };
      }
    }

    const initialBase: Snapshot = {
      state: stateDefaults,
      requests,
      derived: {},
      config: configDefaults,
      modals: {},
    };
    initialBase.derived = computeDerived(ir, initialBase);
    this.snap = initialBase;
  }

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): Snapshot => this.snap;

  /** Build the eval scope from the current snapshot. */
  scope(extra: Scope = {}): Scope {
    // Built-in identifiers exposed as getters so each access yields a fresh
    // value — used by IRs that need to mint ids or timestamps without a
    // function-call grammar in the expression evaluator.
    //   {{uuid}} → new RFC4122 string per access
    //   {{now}}  → milliseconds since epoch at access time
    //   {{nowIso}} → ISO 8601 string at access time
    return {
      $state: this.snap.state,
      $request: this.snap.requests,
      $derived: this.snap.derived,
      $config: this.snap.config,
      get uuid() {
        if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
          return crypto.randomUUID();
        }
        // Fallback: short pseudo-random id (sufficient for client-side keys).
        return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
      },
      get now() {
        return Date.now();
      },
      get nowIso() {
        return new Date().toISOString();
      },
      ...extra,
    };
  }

  /** Resolve any expression in the current widget scope plus `extra`. */
  evaluate(expr: unknown, extra: Scope = {}): unknown {
    if (typeof expr !== "string") return expr;
    return evaluate(expr, this.scope(extra));
  }

  // ─── Mutators (action ops call these) ──────────────────────────────────

  setState(id: string, value: unknown): void {
    if (!this.hasState(id)) {
      // Silent no-op was masking real bugs (Form.bind referencing undeclared
      // state, agent typo, etc.). Warn loudly so the symptom — input typed
      // into but value never updates — is debuggable from the console.
      if (typeof console !== "undefined") {
        console.warn(
          `[widget-runtime] setState("${id}", ...) — state id not declared in IR.state[]. Add { id: "${id}", type: "...", default: ... } to the widget IR.`,
        );
      }
      return;
    }
    this.commit({
      ...this.snap,
      state: { ...this.snap.state, [id]: value },
    });
  }

  mutateArray(
    id: string,
    op: "append" | "prepend" | "remove_where" | "patch_where" | "set",
    payload: { value?: unknown; where?: (item: unknown, index: number) => boolean },
  ): void {
    if (!this.hasState(id)) {
      if (typeof console !== "undefined") {
        console.warn(
          `[widget-runtime] mutateState("${id}", "${op}") — state id not declared in IR.state[].`,
        );
      }
      return;
    }
    const cur = this.snap.state[id];

    if (op === "set") {
      this.setState(id, payload.value);
      return;
    }
    if (!Array.isArray(cur)) {
      // Initialize as array if undefined; otherwise leave alone.
      if (cur == null) {
        this.setState(id, op === "remove_where" ? [] : [payload.value].filter((v) => v !== undefined));
        return;
      }
      return;
    }

    let next: unknown[];
    switch (op) {
      case "append":
        next = [...cur, payload.value];
        break;
      case "prepend":
        next = [payload.value, ...cur];
        break;
      case "remove_where":
        next = payload.where
          ? cur.filter((item, idx) => !payload.where!(item, idx))
          : cur;
        break;
      case "patch_where":
        next = cur.map((item, idx) =>
          payload.where && payload.where(item, idx)
            ? mergePatch(item, payload.value)
            : item,
        );
        break;
    }
    this.setState(id, next);
  }

  setModalOpen(blockId: string, open: boolean): void {
    // When closing, also clear any *flag-shaped* state bound to the modal's
    // `open` field. Two flag patterns are recognized:
    //   - string id (the "editingId" pattern: "" = closed, non-empty = open)
    //   - boolean   (true = open, false = closed)
    //
    // Object/array/number state is NEVER cleared on close — that's user
    // data (form values, settings) and clearing it on modal close would
    // wipe what the user just typed. The agent should bind Modal.open to
    // a separate flag state, distinct from any Form.bind state.
    let nextState = this.snap.state;
    if (!open) {
      const block = this.findBlockById(blockId);
      if (block && block.type === "Modal" && typeof block.open === "string") {
        const boundId = block.open;
        if (boundId in nextState) {
          const cur = nextState[boundId];
          if (typeof cur === "string" && cur !== "") {
            nextState = { ...nextState, [boundId]: "" };
          } else if (cur === true) {
            nextState = { ...nextState, [boundId]: false };
          }
          // Object/array/number/null/undefined: leave alone — user data.
        }
      }
    }
    this.commit({
      ...this.snap,
      state: nextState,
      modals: { ...this.snap.modals, [blockId]: open },
    });
  }

  /** Walk the block tree to find a block by id (used for Modal lookups). */
  private findBlockById(id: string): Record<string, unknown> | null {
    const stack: unknown[] = [...this.ir.blocks];
    while (stack.length > 0) {
      const block = stack.pop();
      if (!block || typeof block !== "object") continue;
      const b = block as Record<string, unknown>;
      if (b.id === id) return b;
      if (Array.isArray(b.children)) {
        stack.push(...(b.children as unknown[]));
      }
    }
    return null;
  }

  /** Set a request result — used by v1.1+ when AI/integration requests run. */
  setRequestResult(id: string, value: unknown): void {
    this.commit({
      ...this.snap,
      requests: { ...this.snap.requests, [id]: value },
    });
  }

  /**
   * Force a re-render without changing data — used by the `now` ticker so
   * derived values (and any expression referencing `{{now}}`) re-evaluate at
   * the tick cadence. Produces a fresh snapshot reference so
   * `useSyncExternalStore`'s identity check fires.
   */
  tick(): void {
    this.commit({ ...this.snap });
  }

  // ─── Internals ─────────────────────────────────────────────────────────

  private hasState(id: string): boolean {
    return this.ir.state?.some((s) => s.id === id) ?? false;
  }

  private commit(next: Snapshot): void {
    next.derived = computeDerived(this.ir, next);
    this.snap = next;
    for (const listener of this.listeners) listener();
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function defaultForType(type: string): unknown {
  switch (type) {
    case "array":
      return [];
    case "object":
      return {};
    case "boolean":
      return false;
    case "number":
      return 0;
    case "string":
    default:
      return "";
  }
}

function computeDerived(ir: WidgetIR, base: Snapshot): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!ir.derived || ir.derived.length === 0) return out;
  // Build a scope that *includes* `out` itself so later derived can reference
  // earlier ones via `{{ $derived.foo }}`.
  for (const d of ir.derived) {
    const scope = {
      $state: base.state,
      $request: base.requests,
      $derived: out,
      $config: base.config,
    };
    try {
      out[d.id] = evaluate(d.expr, scope);
    } catch (err) {
      if (typeof console !== "undefined") {
        console.warn(`[widget-runtime] derived "${d.id}" failed`, err);
      }
      out[d.id] = undefined;
    }
  }
  return out;
}

function mergePatch(item: unknown, patch: unknown): unknown {
  if (!item || typeof item !== "object") return item;
  if (!patch || typeof patch !== "object") return item;
  return { ...(item as object), ...(patch as object) };
}
