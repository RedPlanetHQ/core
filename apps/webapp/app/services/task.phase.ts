import type { TaskStatus } from "@prisma/client";

export type { TaskStatus };

/**
 * A task's phase — which mind the agent is in when it picks up the task.
 *
 * - "execute" = the default. The agent reads the task and does the work.
 * - "prep"    = the agent self-promoted via the enter_plan_mode tool to
 *               gather information / shape an open-ended goal. It writes
 *               a plan into the task description, then calls
 *               exit_plan_mode to drop back into execute.
 *
 * Phase is agent-driven, not status-driven. Status transitions do NOT
 * change phase — that prevents an in-flight plan from being silently
 * undone by an update_task(status: "Waiting") side-effect.
 *
 * Only "prep" is stored in metadata. Absence of `metadata.phase` is
 * execute.
 */
export type TaskPhase = "prep" | "execute";

/**
 * Who is attempting a status transition.
 * - "agent"  = butler calling update_task (or equivalent tool)
 * - "user"   = explicit user action (UI button, manual status change)
 * - "system" = time-driven wake-up handler or recurring-advance scheduler
 */
export type TransitionActor = "agent" | "user" | "system";

// ─── Phase storage helpers ──────────────────────────────────────────

/**
 * Read the phase for a task. "prep" is recorded in metadata when the agent
 * calls enter_plan_mode; everything else (including absence of metadata,
 * legacy values, and explicit "execute") is execute.
 */
export function getTaskPhase(task: {
  status: TaskStatus;
  metadata?: unknown;
}): TaskPhase {
  const meta =
    task.metadata && typeof task.metadata === "object"
      ? (task.metadata as Record<string, unknown>)
      : null;
  return meta?.phase === "prep" ? "prep" : "execute";
}

/**
 * Immutably produce a new metadata object with `phase` set. Caller is
 * responsible for persisting the result (typically via prisma.task.update).
 *
 * When `phase === "execute"` the phase key is REMOVED from metadata rather
 * than set — execute is the implicit default and storing it would just
 * add noise (and would force every transition to write metadata even when
 * the phase didn't change).
 */
export function setTaskPhaseInMetadata(
  existing: unknown,
  phase: TaskPhase,
): Record<string, unknown> {
  const base =
    existing && typeof existing === "object"
      ? (existing as Record<string, unknown>)
      : {};
  if (phase === "execute") {
    const { phase: _phase, ...rest } = base;
    return rest;
  }
  return { ...base, phase };
}

// ─── Transition validation ──────────────────────────────────────────

/**
 * Decide whether a (from → to) status transition is allowed for the given
 * actor. Phase is NOT consulted — status and phase are independent in the
 * execute-first lifecycle (phase is agent-driven via enter/exit_plan_mode
 * only).
 *
 * Agent-allowed targets: Waiting, Review. Everything else is reserved for
 * system (runtime promotions, scheduled fires) or user (UI / approval).
 */
export function canTransition(
  from: TaskStatus,
  to: TaskStatus,
  actor: TransitionActor,
): boolean {
  if (from === to) return true;

  // Agents may only put a task into Waiting (block, need user input) or
  // Review (work complete, awaiting user verification). Working / Done /
  // Todo / Ready are all system- or user-driven in execute-first.
  if (
    actor === "agent" &&
    (to === "Working" || to === "Done" || to === "Todo" || to === "Ready")
  ) {
    return false;
  }

  return true;
}
