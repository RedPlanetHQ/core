/**
 * Executor types — shared between concrete executors and the orchestrator.
 */

import type { Scope } from "~/components/widgets/runtime/expression";

export interface ExecutorContext {
  workspaceId: string;
  userId: string;
  /** Merged scope ($config, $state, plus $request.* of already-executed reqs). */
  scope: Scope;
}

export interface ExecutorResult {
  ok: boolean;
  value?: unknown;
  error?: string;
}

export type Executor<R = unknown> = (
  request: R,
  ctx: ExecutorContext,
) => Promise<ExecutorResult>;
