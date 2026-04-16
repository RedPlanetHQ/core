import type { TaskStatus } from "@prisma/client";

export type { TaskStatus };

/**
 * A task's phase. Stored in `task.metadata.phase`.
 *
 * - "prep"    = Phase 1: butler is preparing the task (Todo ⇄ Waiting → Ready).
 * - "execute" = Phase 2: butler is executing (Ready → Working ⇄ Waiting → Review → Done).
 *
 * Phase disambiguates the `Waiting` status, which can legitimately appear in
 * either phase. When the user answers a Waiting question, phase tells the
 * agent whether the answer feeds planning or execution.
 */
export type TaskPhase = "prep" | "execute";

/**
 * Who is attempting a status transition.
 * - "agent"  = butler calling update_task (or equivalent tool)
 * - "user"   = explicit user action (UI button, manual status change)
 * - "system" = time-driven wake-up handler or recurring-advance scheduler
 */
export type TransitionActor = "agent" | "user" | "system";

const PHASE_1_STATUSES: TaskStatus[] = ["Todo", "Waiting"];

// ─── Phase storage helpers ──────────────────────────────────────────

/**
 * Read the phase for a task. Phase lives in `task.metadata.phase`. When
 * absent (older tasks created before this feature), we infer from status:
 * Todo/Waiting → prep, everything else → execute.
 */
export function getTaskPhase(task: {
  status: TaskStatus;
  metadata?: unknown;
}): TaskPhase {
  const meta =
    task.metadata && typeof task.metadata === "object"
      ? (task.metadata as Record<string, unknown>)
      : null;
  const raw = meta?.phase;
  if (raw === "prep" || raw === "execute") return raw;
  return inferPhaseFromStatus(task.status);
}

/**
 * Default phase for a given status when no metadata is present. Matches the
 * backfill rule: Phase 1 statuses are prep, everything else is execute.
 */
export function inferPhaseFromStatus(status: TaskStatus): TaskPhase {
  if (status === "Todo" || status === "Waiting") return "prep";
  return "execute";
}

/**
 * Immutably produce a new metadata object with `phase` set. Caller is
 * responsible for persisting the result (typically via prisma.task.update).
 */
export function setTaskPhaseInMetadata(
  existing: unknown,
  phase: TaskPhase,
): Record<string, unknown> {
  const base =
    existing && typeof existing === "object"
      ? (existing as Record<string, unknown>)
      : {};
  return { ...base, phase };
}

// ─── Transition validation ──────────────────────────────────────────

/**
 * Decide whether a (from → to) status transition is allowed for the given
 * actor and current phase. Encodes the spec's transition table.
 */
export function canTransition(
  from: TaskStatus,
  to: TaskStatus,
  phase: TaskPhase,
  actor: TransitionActor,
): boolean {
  if (from === to) return true;

  // Done is user-only — full stop. Agent and system cannot set Done.
  if (to === "Done") {
    return actor === "user";
  }

  // Recurring Review → Ready loop is system-driven (scheduleNextTaskOccurrence)
  // or user-driven (manual re-queue).
  if (from === "Review" && to === "Ready") {
    return actor === "system" || actor === "user";
  }

  // Phase 1 transitions.
  if (phase === "prep") {
    if (PHASE_1_STATUSES.includes(from) && PHASE_1_STATUSES.includes(to)) {
      return true;
    }
    // Todo/Waiting → Ready: agent (butler decides ready) or user (force-promote).
    if (PHASE_1_STATUSES.includes(from) && to === "Ready") {
      return actor === "agent" || actor === "user";
    }
    // Todo/Waiting → Review: synchronous finish during prep — butler answered
    // the user inline or the work turned out to be trivial/already-done and no
    // execution step is needed. Allowed for agent and user.
    if (PHASE_1_STATUSES.includes(from) && to === "Review") {
      return actor === "agent" || actor === "user";
    }
    // System-only: fire-override from Phase 1 to Working.
    if (PHASE_1_STATUSES.includes(from) && to === "Working") {
      return actor === "system";
    }
    return false;
  }

  // Phase 2 transitions.
  if (phase === "execute") {
    // Ready → Working is the normal fire path; allowed for system (schedule)
    // and user (manual start-now).
    if (from === "Ready" && to === "Working") {
      return actor === "system" || actor === "user";
    }
    // Ready → Review (butler finished without needing an execution step —
    // e.g., pure research/planning task done synchronously) or Ready → Waiting
    // (butler needs input before it can even start).
    if (from === "Ready" && (to === "Review" || to === "Waiting")) {
      return true;
    }
    // Working → Waiting (butler blocked), Working → Review (butler done).
    if (from === "Working" && (to === "Waiting" || to === "Review")) {
      return true;
    }
    // Waiting → Working (user answered, butler resumes).
    if (from === "Waiting" && to === "Working") {
      return true;
    }
    // Waiting → Review (butler finished from a waiting state without needing
    // more work — e.g., user answer made the task trivially complete).
    if (from === "Waiting" && to === "Review") {
      return true;
    }
    // Review → Waiting (user rejected, more work needed).
    if (from === "Review" && to === "Waiting") {
      return actor === "user" || actor === "agent";
    }
    return false;
  }

  return false;
}

/**
 * Given a validated transition, compute the new `phase` value.
 * Called after canTransition returns true.
 */
export function inferNewPhase(
  from: TaskStatus,
  to: TaskStatus,
  currentPhase: TaskPhase,
): TaskPhase {
  // Any transition TO Ready/Working/Review/Done flips to execute.
  if (to === "Ready" || to === "Working" || to === "Review" || to === "Done") {
    return "execute";
  }
  // Waiting keeps the current phase (the disambiguation problem — Waiting can
  // exist in either phase, so we preserve whichever we were in).
  if (to === "Waiting") {
    return currentPhase;
  }
  // Todo is always prep (only entered fresh; we don't go back to Todo).
  if (to === "Todo") {
    return "prep";
  }
  return currentPhase;
}
