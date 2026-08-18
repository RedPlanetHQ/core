import type { TaskStatus } from "@prisma/client";

export type { TaskStatus };

/**
 * Who is attempting a status transition.
 * - "agent"  = agent calling update_task (or equivalent tool)
 * - "user"   = explicit user action (UI button, manual status change)
 * - "system" = time-driven wake-up handler or recurring-advance scheduler
 */
export type TransitionActor = "agent" | "user" | "system";

/**
 * Decide whether a (from → to) status transition is allowed for the given
 * actor.
 *
 * Agent-allowed targets: Waiting, Review. Everything else is reserved for
 * system (runtime promotions, scheduled fires) or user (UI / approval).
 *
 * The phase concept (plan / execute mind, driven by `enter_plan_mode` /
 * `exit_plan_mode`) was removed. Tasks live in a single execution mode; if
 * phased execution comes back it should be driven off task metadata via
 * `update_task`, not a dedicated tool surface.
 */
export function canTransition(
  from: TaskStatus,
  to: TaskStatus,
  actor: TransitionActor,
): boolean {
  if (from === to) return true;

  // Agents may only put a task into Waiting (block, need user input) or
  // Review (work complete, awaiting user verification). Working / Done /
  // Todo / Ready are all system- or user-driven.
  if (
    actor === "agent" &&
    (to === "Working" || to === "Done" || to === "Todo" || to === "Ready")
  ) {
    return false;
  }

  return true;
}
