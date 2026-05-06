/**
 * Action dispatcher — v0.
 *
 * Looks up an action by id in the IR, evaluates each `do` op against a
 * scope (state + requests + derived + config + caller-supplied args/event),
 * and applies it to the store.
 *
 * Supported ops:
 *   - setState         set a state field to a value (templated allowed)
 *   - mutateState      append/prepend/remove_where/patch_where/set on an array state
 *   - openModal        flip a Modal block's open flag to true
 *   - closeModal       flip it to false
 *   - runRequest       v0: no-op (logs warning). v1.1 wires this to the request executor.
 *
 * Confirm prompts are shown via window.confirm in v0 — good enough for
 * shipping the architecture; v1.3 will replace with an in-widget dialog.
 */

import type { ActionOp, WidgetAction, WidgetIR } from "@core/types";
import { evaluate, evaluateValue, truthy, type Scope } from "./expression";
import type { WidgetStore } from "./store";

export interface DispatchContext {
  store: WidgetStore;
  ir: WidgetIR;
  /** Inline args from the block (e.g. {{ id }} on List item onClick). */
  args?: Record<string, unknown>;
  /** Event payload (e.g. form values on submit). */
  event?: Record<string, unknown>;
  /** Whether to bypass confirm prompts (used for chained ops, internal calls). */
  skipConfirm?: boolean;
}

export function dispatchAction(actionId: string, ctx: DispatchContext): void {
  const action = (ctx.ir.actions ?? []).find((a) => a.id === actionId);
  if (!action) {
    if (typeof console !== "undefined") {
      console.warn(`[widget-runtime] unknown action "${actionId}"`);
    }
    return;
  }
  if (action.confirm && !ctx.skipConfirm && typeof window !== "undefined") {
    if (!window.confirm(action.confirm)) return;
  }
  for (const op of action.do) {
    runOp(op, action, ctx);
  }
}

function runOp(op: ActionOp, action: WidgetAction, ctx: DispatchContext): void {
  const scope: Scope = {
    ...ctx.store.scope(),
    args: ctx.args ?? {},
    event: ctx.event ?? {},
  };

  switch (op.op) {
    case "setState": {
      const value = evaluateValue(op.value, scope);
      ctx.store.setState(op.state, value);
      break;
    }
    case "mutateState": {
      const value = evaluateValue(op.value, scope);
      const where = op.where
        ? buildPredicate(op.where, scope, ctx)
        : undefined;
      ctx.store.mutateArray(op.state, op.mutation, { value, where });
      break;
    }
    case "openModal":
      ctx.store.setModalOpen(op.block, true);
      break;
    case "closeModal":
      ctx.store.setModalOpen(op.block, false);
      break;
    case "runRequest":
      // v0: not implemented. v1.1 will dispatch to the request executor.
      if (typeof console !== "undefined") {
        console.warn(
          `[widget-runtime] runRequest("${op.request}") — request execution lands in v1.1`,
        );
      }
      break;
  }
}

/**
 * Build an item predicate from a templated where-clause. The where string is
 * evaluated for each candidate item with `item` and `index` added to scope.
 */
function buildPredicate(
  whereExpr: string,
  baseScope: Scope,
  _ctx: DispatchContext,
): (item: unknown, index: number) => boolean {
  return (item, index) => {
    const result = evaluate(whereExpr, { ...baseScope, item, index });
    return truthy(result);
  };
}
