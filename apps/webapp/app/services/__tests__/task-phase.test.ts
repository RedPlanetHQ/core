import { describe, expect, it } from "vitest";
import {
  canTransition,
  getTaskPhase,
  setTaskPhaseInMetadata,
} from "~/services/task.phase";

// ─── getTaskPhase ───────────────────────────────────────────────────

describe("getTaskPhase", () => {
  it("returns prep only when metadata.phase is explicitly 'prep'", () => {
    expect(getTaskPhase({ status: "Todo", metadata: { phase: "prep" } })).toBe(
      "prep",
    );
    expect(getTaskPhase({ status: "Ready", metadata: { phase: "prep" } })).toBe(
      "prep",
    );
  });

  it("returns execute when metadata is missing (absence = execute)", () => {
    expect(getTaskPhase({ status: "Todo", metadata: null })).toBe("execute");
    expect(getTaskPhase({ status: "Waiting", metadata: {} })).toBe("execute");
    expect(getTaskPhase({ status: "Ready", metadata: null })).toBe("execute");
    expect(getTaskPhase({ status: "Working", metadata: null })).toBe("execute");
    expect(getTaskPhase({ status: "Review", metadata: null })).toBe("execute");
    expect(getTaskPhase({ status: "Done", metadata: null })).toBe("execute");
    expect(getTaskPhase({ status: "Recurring", metadata: null })).toBe(
      "execute",
    );
  });

  it("returns execute for explicit metadata.phase = 'execute' (legacy)", () => {
    expect(
      getTaskPhase({ status: "Todo", metadata: { phase: "execute" } }),
    ).toBe("execute");
    expect(
      getTaskPhase({ status: "Ready", metadata: { phase: "execute" } }),
    ).toBe("execute");
  });

  it("ignores non-string phase values in metadata (defaults to execute)", () => {
    expect(getTaskPhase({ status: "Todo", metadata: { phase: 42 } })).toBe(
      "execute",
    );
    expect(
      getTaskPhase({ status: "Ready", metadata: { phase: "invalid" } }),
    ).toBe("execute");
  });
});

// ─── setTaskPhaseInMetadata ─────────────────────────────────────────

describe("setTaskPhaseInMetadata", () => {
  it("sets phase=prep on empty metadata", () => {
    expect(setTaskPhaseInMetadata(null, "prep")).toEqual({ phase: "prep" });
  });

  it("removes the phase key when set to execute (execute is implicit)", () => {
    expect(setTaskPhaseInMetadata({}, "execute")).toEqual({});
    expect(setTaskPhaseInMetadata({ phase: "prep" }, "execute")).toEqual({});
  });

  it("preserves other metadata keys when setting prep", () => {
    const result = setTaskPhaseInMetadata(
      { rescheduleCount: 2, skillId: "s1" },
      "prep",
    );
    expect(result).toEqual({
      rescheduleCount: 2,
      skillId: "s1",
      phase: "prep",
    });
  });

  it("preserves other metadata keys when setting execute (only phase is dropped)", () => {
    const result = setTaskPhaseInMetadata(
      { rescheduleCount: 2, phase: "prep" },
      "execute",
    );
    expect(result).toEqual({ rescheduleCount: 2 });
  });

  it("overwrites existing phase=prep when setting prep again", () => {
    expect(setTaskPhaseInMetadata({ phase: "prep" }, "prep")).toEqual({
      phase: "prep",
    });
  });
});

// ─── canTransition ──────────────────────────────────────────────────

describe("canTransition", () => {
  // Agents may only set Waiting or Review. Everything else is system/user.
  it("allows agent to set Waiting from any status", () => {
    expect(canTransition("Todo", "Waiting", "agent")).toBe(true);
    expect(canTransition("Ready", "Waiting", "agent")).toBe(true);
    expect(canTransition("Working", "Waiting", "agent")).toBe(true);
    expect(canTransition("Review", "Waiting", "agent")).toBe(true);
  });

  it("allows agent to set Review from any status", () => {
    expect(canTransition("Todo", "Review", "agent")).toBe(true);
    expect(canTransition("Ready", "Review", "agent")).toBe(true);
    expect(canTransition("Working", "Review", "agent")).toBe(true);
    expect(canTransition("Waiting", "Review", "agent")).toBe(true);
  });

  it("forbids agent from setting Working (system-only)", () => {
    expect(canTransition("Ready", "Working", "agent")).toBe(false);
    expect(canTransition("Waiting", "Working", "agent")).toBe(false);
    expect(canTransition("Todo", "Working", "agent")).toBe(false);
  });

  it("forbids agent from setting Done (user-only)", () => {
    expect(canTransition("Review", "Done", "agent")).toBe(false);
    expect(canTransition("Working", "Done", "agent")).toBe(false);
  });

  it("forbids agent from setting Todo (parking is system/user)", () => {
    expect(canTransition("Waiting", "Todo", "agent")).toBe(false);
  });

  it("forbids agent from setting Ready (system handles unblock and buffer expiry)", () => {
    expect(canTransition("Todo", "Ready", "agent")).toBe(false);
    expect(canTransition("Waiting", "Ready", "agent")).toBe(false);
    expect(canTransition("Working", "Ready", "agent")).toBe(false);
    expect(canTransition("Review", "Ready", "agent")).toBe(false);
  });

  // User-driven transitions — unrestricted
  it("allows user transitions across the lifecycle", () => {
    expect(canTransition("Waiting", "Ready", "user")).toBe(true);
    expect(canTransition("Review", "Done", "user")).toBe(true);
    expect(canTransition("Todo", "Ready", "user")).toBe(true);
    expect(canTransition("Working", "Done", "user")).toBe(true);
  });

  // System-driven transitions — unrestricted (time-triggered wake-ups, recurring advance)
  it("allows system transitions across the lifecycle", () => {
    expect(canTransition("Ready", "Working", "system")).toBe(true);
    expect(canTransition("Todo", "Working", "system")).toBe(true);
    expect(canTransition("Waiting", "Working", "system")).toBe(true);
    expect(canTransition("Review", "Ready", "system")).toBe(true);
  });

  it("allows same-status no-op transitions for any actor", () => {
    expect(canTransition("Working", "Working", "agent")).toBe(true);
    expect(canTransition("Ready", "Ready", "user")).toBe(true);
    expect(canTransition("Done", "Done", "system")).toBe(true);
  });
});
