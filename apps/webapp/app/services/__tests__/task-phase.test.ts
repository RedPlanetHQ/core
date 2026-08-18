import { describe, expect, it } from "vitest";
import { canTransition } from "~/services/task.phase";

// Transition-only tests. The plan/execute phase concept (getTaskPhase /
// setTaskPhaseInMetadata) was removed along with the enter_plan_mode /
// exit_plan_mode tools; tasks live in a single execution mode now.

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
