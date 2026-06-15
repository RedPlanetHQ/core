import { describe, expect, it } from "vitest";
import {
  parseActionPlan,
  normalizeActionPlan,
  createFallbackPlan,
} from "~/services/agent/agents/decision";

// parseActionPlan

describe("parseActionPlan", () => {
  // Path 1: direct JSON parse

  it("parses valid JSON directly", () => {
    const input = JSON.stringify({
      shouldMessage: true,
      message: { intent: "greet", context: {}, tone: "neutral" },
      createFollowUps: [],
      updateTasks: [],
      silentActions: [],
      reasoning: "test",
    });
    const plan = parseActionPlan(input);
    expect(plan).not.toBeNull();
    expect(plan!.shouldMessage).toBe(true);
    expect(plan!.message?.intent).toBe("greet");
    expect(plan!.reasoning).toBe("test");
  });

  it("parses shouldMessage=false without a message field", () => {
    const input = JSON.stringify({
      shouldMessage: false,
      createFollowUps: [],
      updateTasks: [],
      silentActions: [],
      reasoning: "silent run",
    });
    const plan = parseActionPlan(input);
    expect(plan).not.toBeNull();
    expect(plan!.shouldMessage).toBe(false);
  });

  // Path 2: JSON inside markdown code fence

  it("extracts JSON from ```json code fence", () => {
    const json = JSON.stringify({
      shouldMessage: true,
      message: { intent: "remind", context: {}, tone: "casual" },
      reasoning: "fenced",
    });
    const input = `Here is the plan:\n\`\`\`json\n${json}\n\`\`\`\nDone.`;
    const plan = parseActionPlan(input);
    expect(plan).not.toBeNull();
    expect(plan!.message?.intent).toBe("remind");
  });

  it("extracts JSON from ``` code fence (no language tag)", () => {
    const json = JSON.stringify({
      shouldMessage: false,
      reasoning: "no-lang fence",
    });
    const input = `\`\`\`\n${json}\n\`\`\``;
    const plan = parseActionPlan(input);
    expect(plan).not.toBeNull();
    expect(plan!.shouldMessage).toBe(false);
  });

  // Path 3: regex-extracted {…} from freeform text

  it("finds JSON object embedded in prose", () => {
    const json = JSON.stringify({
      shouldMessage: true,
      message: { intent: "alert", context: {}, tone: "urgent" },
      reasoning: "embedded",
    });
    const input = `I've analyzed the trigger. My plan: ${json} — that's it.`;
    const plan = parseActionPlan(input);
    expect(plan).not.toBeNull();
    expect(plan!.reasoning).toBe("embedded");
  });

  // Validation failures

  it("returns null when shouldMessage is missing", () => {
    const input = JSON.stringify({
      message: { intent: "test", context: {}, tone: "neutral" },
      reasoning: "no flag",
    });
    expect(parseActionPlan(input)).toBeNull();
  });

  it("returns null when shouldMessage is not a boolean", () => {
    const input = JSON.stringify({
      shouldMessage: "yes",
      message: { intent: "test", context: {}, tone: "neutral" },
      reasoning: "string flag",
    });
    expect(parseActionPlan(input)).toBeNull();
  });

  it("returns null when shouldMessage=true but message is missing", () => {
    const input = JSON.stringify({
      shouldMessage: true,
      reasoning: "no message",
    });
    expect(parseActionPlan(input)).toBeNull();
  });

  it("returns null when createFollowUps is not an array", () => {
    const input = JSON.stringify({
      shouldMessage: false,
      createFollowUps: "not-array",
      reasoning: "bad array",
    });
    expect(parseActionPlan(input)).toBeNull();
  });

  it("returns null when updateTasks is not an array", () => {
    const input = JSON.stringify({
      shouldMessage: false,
      updateTasks: { id: "1" },
      reasoning: "bad array",
    });
    expect(parseActionPlan(input)).toBeNull();
  });

  it("returns null when silentActions is not an array", () => {
    const input = JSON.stringify({
      shouldMessage: false,
      silentActions: 42,
      reasoning: "bad array",
    });
    expect(parseActionPlan(input)).toBeNull();
  });

  // Malformed inputs

  it("returns null for completely invalid JSON", () => {
    expect(parseActionPlan("this is not json at all")).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(parseActionPlan("")).toBeNull();
  });

  it("returns null for JSON that is valid but not an ActionPlan (array)", () => {
    expect(parseActionPlan("[1, 2, 3]")).toBeNull();
  });

  it("returns null for JSON that is valid but not an ActionPlan (primitive)", () => {
    expect(parseActionPlan('"just a string"')).toBeNull();
  });

  it("returns null for malformed JSON inside a code fence", () => {
    const input = "```json\n{ shouldMessage: true, }\n```";
    expect(parseActionPlan(input)).toBeNull();
  });

  it("returns null when the only braced text is not valid JSON", () => {
    const input = "Here is the plan: { shouldMessage: true, broken }";
    expect(parseActionPlan(input)).toBeNull();
  });

  // Optional arrays can be omitted

  it("accepts a plan with optional array fields omitted", () => {
    const input = JSON.stringify({
      shouldMessage: false,
      reasoning: "minimal plan",
    });
    const plan = parseActionPlan(input);
    expect(plan).not.toBeNull();
    expect(plan!.shouldMessage).toBe(false);
  });
});

// normalizeActionPlan 

describe("normalizeActionPlan", () => {
  it("fills default empty arrays for undefined optional fields", () => {
    const plan = normalizeActionPlan({
      shouldMessage: false,
      reasoning: "test",
    } as any);
    expect(plan.createFollowUps).toEqual([]);
    expect(plan.updateTasks).toEqual([]);
    expect(plan.silentActions).toEqual([]);
  });

  it("preserves existing array values", () => {
    const followUp = { title: "check", schedule: "FREQ=DAILY" };
    const plan = normalizeActionPlan({
      shouldMessage: true,
      message: { intent: "go", context: {}, tone: "neutral" },
      createFollowUps: [followUp],
      updateTasks: [],
      silentActions: [],
      reasoning: "has data",
    });
    expect(plan.createFollowUps).toEqual([followUp]);
    expect(plan.reasoning).toBe("has data");
  });

  it("fills default reasoning when omitted", () => {
    const plan = normalizeActionPlan({
      shouldMessage: false,
    } as any);
    expect(plan.reasoning).toBe("No reasoning provided");
  });

  it("preserves shouldMessage and message fields", () => {
    const message = {
      intent: "greet",
      context: { key: "val" },
      tone: "casual" as const,
    };
    const plan = normalizeActionPlan({
      shouldMessage: true,
      message,
      reasoning: "ok",
    } as any);
    expect(plan.shouldMessage).toBe(true);
    expect(plan.message).toEqual(message);
  });
});

// createFallbackPlan

describe("createFallbackPlan", () => {
  it("returns shouldMessage=true for reminder_fired", () => {
    const plan = createFallbackPlan({
      type: "reminder_fired",
      data: { action: "drink water", reminderId: "r1" },
    } as any);
    expect(plan.shouldMessage).toBe(true);
    expect(plan.message?.intent).toContain("drink water");
    expect(plan.reasoning).toContain("Fallback");
  });

  it("returns shouldMessage=true for reminder_followup", () => {
    const plan = createFallbackPlan({
      type: "reminder_followup",
      data: { action: "check status", reminderId: "r2" },
    } as any);
    expect(plan.shouldMessage).toBe(true);
    expect(plan.message?.intent).toContain("check status");
    expect(plan.message?.tone).toBe("casual");
  });

  it("returns shouldMessage=true for daily_sync", () => {
    const plan = createFallbackPlan({
      type: "daily_sync",
      data: { syncType: "daily" },
    } as any);
    expect(plan.shouldMessage).toBe(true);
    expect(plan.message?.intent).toContain("briefing");
  });

  it("returns shouldMessage=false with silent log for integration_webhook", () => {
    const plan = createFallbackPlan({
      type: "integration_webhook",
      data: { integration: "github", eventType: "push", payload: {} },
    } as any);
    expect(plan.shouldMessage).toBe(false);
    expect(plan.silentActions).toHaveLength(1);
    expect(plan.silentActions[0].type).toBe("log");
    expect(plan.silentActions[0].description).toContain("github");
  });

  it("returns shouldMessage=false with silent log for scheduled_check", () => {
    const plan = createFallbackPlan({
      type: "scheduled_check",
      data: { checkType: "health-ping" },
    } as any);
    expect(plan.shouldMessage).toBe(false);
    expect(plan.silentActions[0].description).toContain("health-ping");
  });

  it("returns shouldMessage=true for scheduled_task_fired", () => {
    const plan = createFallbackPlan({
      type: "scheduled_task_fired",
      data: { action: "send report", taskId: "tk-abc" },
    } as any);
    expect(plan.shouldMessage).toBe(true);
    expect(plan.message?.intent).toContain("send report");
  });

  it("returns default plan for unknown trigger types", () => {
    const plan = createFallbackPlan({
      type: "some_future_type",
      data: {},
    } as any);
    expect(plan.shouldMessage).toBe(true);
    expect(plan.reasoning).toContain("Default plan");
  });

  it("always includes empty arrays for createFollowUps, updateTasks, silentActions (when not populated)", () => {
    const plan = createFallbackPlan({
      type: "reminder_fired",
      data: { action: "test", reminderId: "r3" },
    } as any);
    expect(plan.createFollowUps).toEqual([]);
    expect(plan.updateTasks).toEqual([]);
  });
});
