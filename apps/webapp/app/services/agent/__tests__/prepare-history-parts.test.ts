import { describe, expect, it } from "vitest";
import {
  prepareHistoryParts,
  type MessagePart,
} from "~/services/agent/context-window";

// prepareHistoryParts

describe("prepareHistoryParts", () => {
  // Non-assistant roles pass through unchanged

  it("returns user parts unchanged", () => {
    const parts: MessagePart[] = [
      { type: "text", text: "hello" },
      {
        type: "tool-agent-gather_context",
        output: { text: "data", subAgentToolResults: [1, 2, 3] },
      },
    ];
    const result = prepareHistoryParts("user", parts);
    expect(result).toEqual(parts);
    expect(result).toBe(parts); // same reference — no copy
  });

  it("returns system parts unchanged", () => {
    const parts: MessagePart[] = [{ type: "text", text: "system prompt" }];
    const result = prepareHistoryParts("system", parts);
    expect(result).toBe(parts);
  });

  // Assistant: regular tool calls pass through

  it("keeps non-agent tool call parts intact", () => {
    const parts: MessagePart[] = [
      { type: "text", text: "I searched for info" },
      {
        type: "tool-create_task",
        toolCallId: "tc_1",
        toolName: "create_task",
        output: { result: "Task created", metadata: { lots: "of data" } },
      },
    ];
    const result = prepareHistoryParts("assistant", parts);
    // Non-agent tools should be unchanged
    expect(result[1]).toEqual(parts[1]);
  });

  it("keeps text parts intact on assistant messages", () => {
    const parts: MessagePart[] = [{ type: "text", text: "Here is the result" }];
    const result = prepareHistoryParts("assistant", parts);
    expect(result[0]).toEqual({ type: "text", text: "Here is the result" });
  });

  // Assistant: sub-agent tool calls get collapsed

  it("collapses tool-agent-* parts to only keep output.text", () => {
    const parts: MessagePart[] = [
      {
        type: "tool-agent-gather_context",
        toolCallId: "tc_2",
        toolName: "gather_context",
        output: {
          text: "Found 3 emails about the quarterly report",
          subAgentToolResults: [
            { toolName: "memory_search", result: "lots of memory data..." },
            { toolName: "web_search", result: "web results..." },
          ],
          steps: [{ text: "step1" }, { text: "step2" }],
        },
      },
    ];
    const result = prepareHistoryParts("assistant", parts);
    // The output should be collapsed to just { text: "..." }
    expect(result[0].output).toEqual({
      text: "Found 3 emails about the quarterly report",
    });
    // Other fields on the part (type, toolCallId, toolName) should remain
    expect(result[0].type).toBe("tool-agent-gather_context");
    expect(result[0].toolCallId).toBe("tc_2");
    expect(result[0].toolName).toBe("gather_context");
  });

  it("collapses tool-agent-take_action the same way", () => {
    const parts: MessagePart[] = [
      {
        type: "tool-agent-take_action",
        output: {
          text: "Created ticket in Linear",
          internalLogs: ["step 1", "step 2"],
        },
      },
    ];
    const result = prepareHistoryParts("assistant", parts);
    expect(result[0].output).toEqual({ text: "Created ticket in Linear" });
  });

  it("handles agent tool parts with missing output gracefully", () => {
    const parts: MessagePart[] = [{ type: "tool-agent-think" }];
    const result = prepareHistoryParts("assistant", parts);
    // output is undefined -> defaults to {}, text is not a string -> ""
    expect(result[0].output).toEqual({ text: "" });
  });

  it("handles agent tool parts with output.text = null", () => {
    const parts: MessagePart[] = [
      {
        type: "tool-agent-gather_context",
        output: { text: null, data: "stuff" },
      },
    ];
    const result = prepareHistoryParts("assistant", parts);
    expect(result[0].output).toEqual({ text: "" });
  });

  it("handles agent tool parts with output.text = number", () => {
    const parts: MessagePart[] = [
      {
        type: "tool-agent-gather_context",
        output: { text: 42 },
      },
    ];
    const result = prepareHistoryParts("assistant", parts);
    // typeof 42 !== "string", so falls back to ""
    expect(result[0].output).toEqual({ text: "" });
  });

  // Mixed parts in a single message

  it("processes a mix of text, regular tool, and agent tool parts correctly", () => {
    const parts: MessagePart[] = [
      { type: "text", text: "Let me check" },
      {
        type: "tool-agent-gather_context",
        output: {
          text: "context result",
          subAgentToolResults: [{ huge: "data" }],
        },
      },
      {
        type: "tool-create_task",
        output: { result: "Task tk-abc created" },
      },
      { type: "step-start" },
      { type: "text", text: "Done." },
      {
        type: "tool-agent-take_action",
        output: {
          text: "action result",
          steps: ["a", "b", "c"],
        },
      },
    ];

    const result = prepareHistoryParts("assistant", parts);
    expect(result).toHaveLength(6);

    // Text parts unchanged
    expect(result[0]).toEqual({ type: "text", text: "Let me check" });
    expect(result[4]).toEqual({ type: "text", text: "Done." });

    // Agent tool parts collapsed
    expect(result[1].output).toEqual({ text: "context result" });
    expect(result[5].output).toEqual({ text: "action result" });

    // Regular tool part unchanged
    expect(result[2].output).toEqual({ result: "Task tk-abc created" });

    // step-start unchanged
    expect(result[3]).toEqual({ type: "step-start" });
  });

  // Edge cases

  it("handles empty parts array", () => {
    const result = prepareHistoryParts("assistant", []);
    expect(result).toEqual([]);
  });

  it("does not mutate the original parts array", () => {
    const original = {
      type: "tool-agent-gather_context",
      output: { text: "hello", extra: "data" },
    };
    const parts: MessagePart[] = [original];
    const result = prepareHistoryParts("assistant", parts);
    // Result should be a new object
    expect(result[0]).not.toBe(original);
    // Original should still have its full output
    expect(original.output).toEqual({ text: "hello", extra: "data" });
  });
});
