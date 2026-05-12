/**
 * Action dispatcher.
 *
 *   dispatchAction("save", { store, ir, args, event, runRequests })
 *
 * Executes an action's `do[]` ops in sequence. `runRequest` ops are awaited
 * — the next op in the sequence runs only after the request returns and the
 * store has its result. This is what makes "click → run mutation → close
 * modal" sequences work cleanly: the modal only closes after the server
 * confirms the mutation completed.
 *
 * Supported ops:
 *   - setState         set a state field to a value (templated allowed)
 *   - mutateState      append/prepend/remove_where/patch_where/set on an array state
 *   - openModal        flip a Modal block's open flag to true
 *   - closeModal       flip it to false
 *   - runRequest       per-request execution; awaitable
 *
 * Confirm prompts use window.confirm in v0 — replace with in-widget dialog
 * later.
 */

import type { ActionOp, WidgetAction, WidgetIR } from "@core/types";
import { evaluate, evaluateValue, truthy, type Scope } from "./expression";
import type { WidgetStore } from "./store";

export interface DispatchContext {
  store: WidgetStore;
  ir: WidgetIR;
  args?: Record<string, unknown>;
  event?: Record<string, unknown>;
  skipConfirm?: boolean;
  /**
   * Per-request runner injected by RuntimeProvider. Pass a requestId to
   * execute just that request (mutation pattern); pass undefined to refresh
   * the whole graph. The `extra` scope (args/event) is forwarded server-side
   * so request `params` templates like `{{args.title}}` resolve correctly
   * when fired from a Form submit or Button click.
   */
  runRequests?: (
    requestId?: string,
    extra?: { args?: Record<string, unknown>; event?: Record<string, unknown> },
  ) => Promise<void>;
}

export async function dispatchAction(
  actionId: string,
  ctx: DispatchContext,
): Promise<void> {
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
    await runOp(op, action, ctx);
  }
}

async function runOp(
  op: ActionOp,
  action: WidgetAction,
  ctx: DispatchContext,
): Promise<void> {
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
      // Awaitable — the next op in the sequence runs only after the request
      // resolves and the store has the result. Critical for mutations:
      //   [ runRequest("send_email"), closeModal("compose") ]
      // The modal only closes after send_email actually completes.
      // Forward args/event so request `params` like `{{args.title}}` resolve
      // server-side against the action's payload.
      try {
        await ctx.runRequests?.(op.request, { args: ctx.args, event: ctx.event });
      } catch (err) {
        if (typeof console !== "undefined") {
          console.warn(
            `[widget-runtime] runRequest("${op.request}") failed`,
            err,
          );
        }
      }
      break;
  }
}

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
