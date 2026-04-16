import { describe, expect, it } from "vitest";
import {
  canTransition,
  inferNewPhase,
  getTaskPhase,
  setTaskPhaseInMetadata,
} from "~/services/task.phase";

// ─── getTaskPhase ───────────────────────────────────────────────────

describe("getTaskPhase", () => {
  it("reads phase from metadata when present", () => {
    expect(getTaskPhase({ status: "Todo", metadata: { phase: "execute" } })).toBe(
      "execute",
    );
    expect(getTaskPhase({ status: "Ready", metadata: { phase: "prep" } })).toBe(
      "prep",
    );
  });

  it("falls back to status-based inference when metadata is missing", () => {
    expect(getTaskPhase({ status: "Todo", metadata: null })).toBe("prep");
    expect(getTaskPhase({ status: "Waiting", metadata: {} })).toBe("prep");
    expect(getTaskPhase({ status: "Ready", metadata: null })).toBe("execute");
    expect(getTaskPhase({ status: "Working", metadata: null })).toBe("execute");
    expect(getTaskPhase({ status: "Review", metadata: null })).toBe("execute");
    expect(getTaskPhase({ status: "Done", metadata: null })).toBe("execute");
    expect(getTaskPhase({ status: "Recurring", metadata: null })).toBe("execute");
  });

  it("ignores non-string phase values in metadata", () => {
    expect(getTaskPhase({ status: "Todo", metadata: { phase: 42 } })).toBe("prep");
    expect(
      getTaskPhase({ status: "Ready", metadata: { phase: "invalid" } }),
    ).toBe("execute");
  });
});

// ─── setTaskPhaseInMetadata ─────────────────────────────────────────

describe("setTaskPhaseInMetadata", () => {
  it("sets phase on empty metadata", () => {
    expect(setTaskPhaseInMetadata(null, "prep")).toEqual({ phase: "prep" });
    expect(setTaskPhaseInMetadata({}, "execute")).toEqual({ phase: "execute" });
  });

  it("preserves other metadata keys", () => {
    const result = setTaskPhaseInMetadata(
      { rescheduleCount: 2, skillId: "s1" },
      "execute",
    );
    expect(result).toEqual({
      rescheduleCount: 2,
      skillId: "s1",
      phase: "execute",
    });
  });

  it("overwrites existing phase", () => {
    expect(setTaskPhaseInMetadata({ phase: "prep" }, "execute")).toEqual({
      phase: "execute",
    });
  });
});

// ─── canTransition ──────────────────────────────────────────────────

describe("canTransition", () => {
  // Butler-driven transitions (actor: "agent")
  it("allows agent Todo -> Waiting", () => {
    expect(canTransition("Todo", "Waiting", "prep", "agent")).toBe(true);
  });

  it("allows agent Todo -> Ready when butler deems it clear", () => {
    expect(canTransition("Todo", "Ready", "prep", "agent")).toBe(true);
  });

  it("allows agent Waiting -> Ready in prep phase", () => {
    expect(canTransition("Waiting", "Ready", "prep", "agent")).toBe(true);
  });

  it("allows agent Working -> Review", () => {
    expect(canTransition("Working", "Review", "execute", "agent")).toBe(true);
  });

  it("allows agent Working -> Waiting in execute phase", () => {
    expect(canTransition("Working", "Waiting", "execute", "agent")).toBe(true);
  });

  // Forbidden butler transitions
  it("forbids agent Review -> Done (user only)", () => {
    expect(canTransition("Review", "Done", "execute", "agent")).toBe(false);
  });

  it("forbids agent Todo -> Working (cross-phase, agent)", () => {
    expect(canTransition("Todo", "Working", "prep", "agent")).toBe(false);
  });

  it("forbids agent Waiting -> Working in prep (cross-phase, agent)", () => {
    expect(canTransition("Waiting", "Working", "prep", "agent")).toBe(false);
  });

  it("forbids agent Prep-phase -> Review directly", () => {
    expect(canTransition("Todo", "Review", "prep", "agent")).toBe(false);
  });

  // User-driven transitions
  it("allows user Waiting -> Ready (force-promote)", () => {
    expect(canTransition("Waiting", "Ready", "prep", "user")).toBe(true);
  });

  it("allows user Review -> Done", () => {
    expect(canTransition("Review", "Done", "execute", "user")).toBe(true);
  });

  it("allows user Todo -> Ready", () => {
    expect(canTransition("Todo", "Ready", "prep", "user")).toBe(true);
  });

  // System-driven transitions (time-triggered wake-ups)
  it("allows system Ready -> Working (scheduled fire)", () => {
    expect(canTransition("Ready", "Working", "execute", "system")).toBe(true);
  });

  it("allows system Todo -> Working (fire-override from prep)", () => {
    expect(canTransition("Todo", "Working", "prep", "system")).toBe(true);
  });

  it("allows system Waiting -> Working (fire-override from prep)", () => {
    expect(canTransition("Waiting", "Working", "prep", "system")).toBe(true);
  });

  it("allows system Review -> Ready (recurring advance)", () => {
    expect(canTransition("Review", "Ready", "execute", "system")).toBe(true);
  });
});

// ─── inferNewPhase ──────────────────────────────────────────────────

describe("inferNewPhase", () => {
  it("stays in prep when status remains in Phase 1", () => {
    expect(inferNewPhase("Todo", "Waiting", "prep")).toBe("prep");
    expect(inferNewPhase("Waiting", "Todo", "prep")).toBe("prep");
  });

  it("moves to execute when reaching Ready from prep", () => {
    expect(inferNewPhase("Todo", "Ready", "prep")).toBe("execute");
    expect(inferNewPhase("Waiting", "Ready", "prep")).toBe("execute");
  });

  it("stays in execute for Phase 2 intra-phase transitions", () => {
    expect(inferNewPhase("Ready", "Working", "execute")).toBe("execute");
    expect(inferNewPhase("Working", "Waiting", "execute")).toBe("execute");
    expect(inferNewPhase("Working", "Review", "execute")).toBe("execute");
    expect(inferNewPhase("Review", "Done", "execute")).toBe("execute");
  });

  it("moves to execute on fire-override", () => {
    expect(inferNewPhase("Todo", "Working", "prep")).toBe("execute");
    expect(inferNewPhase("Waiting", "Working", "prep")).toBe("execute");
  });

  it("stays in execute for recurring Review -> Ready loop", () => {
    expect(inferNewPhase("Review", "Ready", "execute")).toBe("execute");
  });
});
