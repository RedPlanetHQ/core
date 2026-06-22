import { beforeEach, describe, expect, it, vi } from "vitest";
import { convertMessages } from "@mastra/core/agent";
import { logger } from "~/services/logger.service";
import {
  COMPACT_PROMPT_MARKER,
  compactSurvivedInModelMessages,
  describeAgentError,
  estimateMessageTokens,
  generateWithRetry,
  parseCoveredUntil,
  selectModelMessages,
  type MessageEntry,
} from "~/services/agent/context-window";

vi.mock("~/db.server", () => ({
  prisma: {
    document: {
      findUnique: vi.fn(),
    },
  },
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
import { prisma } from "~/db.server";

function msg(
  id: string,
  role: "user" | "assistant",
  text: string,
): MessageEntry {
  return { id, role, parts: [{ type: "text", text }] };
}

describe("describeAgentError", () => {
  it("classifies context-length errors (various providers)", () => {
    const cases = [
      "This model's maximum context length is 200000 tokens",
      "context_length_exceeded: too long",
      "too many tokens in the prompt",
      "prompt is too long, try a shorter one",
      "request exceeds context window of the model",
    ];
    for (const msg of cases) {
      const result = describeAgentError(new Error(msg));
      expect(result.kind).toBe("context-length");
      expect(result.userMessage).toMatch(/too long|conversation/i);
    }
  });

  it("classifies timeout errors", () => {
    const result = describeAgentError(new Error("Request timed out after 60s"));
    expect(result.kind).toBe("timeout");
    expect(result.userMessage).toMatch(/timed out/i);
  });

  it("classifies rate-limit errors", () => {
    for (const msg of ["Rate limit reached", "HTTP 429 Too Many Requests"]) {
      const result = describeAgentError(new Error(msg));
      expect(result.kind).toBe("rate-limit");
    }
  });

  it("classifies unknown errors as other", () => {
    const result = describeAgentError(new Error("Some unknown provider error"));
    expect(result.kind).toBe("other");
    expect(result.userMessage.length).toBeGreaterThan(0);
  });

  it("handles non-Error values", () => {
    expect(describeAgentError("string error").kind).toBe("other");
    expect(describeAgentError(null).kind).toBe("other");
    expect(describeAgentError(undefined).kind).toBe("other");
  });
});

describe("estimateMessageTokens", () => {
  it("counts tokens for text-only messages", () => {
    const msg = {
      id: "1",
      role: "user" as const,
      parts: [{ type: "text", text: "hello world" }],
    };
    const tokens = estimateMessageTokens(msg);
    expect(tokens).toBeGreaterThan(0);
    expect(tokens).toBeLessThan(10); // "hello world" is ~2 tokens
  });

  it("adds 1500 tokens per image/file part", () => {
    const textOnly = {
      id: "1",
      role: "user" as const,
      parts: [{ type: "text", text: "describe this" }],
    };
    const withImage = {
      id: "2",
      role: "user" as const,
      parts: [
        { type: "text", text: "describe this" },
        { type: "file", mediaType: "image/png", url: "data:..." },
      ],
    };
    expect(estimateMessageTokens(withImage)).toBe(
      estimateMessageTokens(textOnly) + 1500,
    );
  });

  it("falls back to chars/4 when tokenizer throws", () => {
    // A message with an unusual structure — we verify it still returns a number.
    const msg = {
      id: "1",
      role: "user" as const,
      parts: [{ type: "text", text: "a".repeat(400) }],
    };
    const tokens = estimateMessageTokens(msg);
    expect(tokens).toBeGreaterThan(0);
  });

  it("returns 0 for a message with no text and no files", () => {
    const msg = {
      id: "1",
      role: "user" as const,
      parts: [{ type: "step-start" }],
    };
    expect(estimateMessageTokens(msg)).toBe(0);
  });
});

describe("selectModelMessages — full mode", () => {
  beforeEach(() => {
    vi.mocked(prisma.document.findUnique).mockReset();
  });

  it("returns history + currentMessage unchanged when under threshold", async () => {
    const history = [
      msg("a", "user", "hi"),
      msg("b", "assistant", "hello"),
    ];
    const current = msg("c", "user", "how are you");
    const result = await selectModelMessages({
      workspaceId: "ws1",
      conversationId: "c1",
      history,
      currentMessage: current,
    });
    expect(result.mode).toBe("full");
    expect(result.messages).toEqual([...history, current]);
    expect(result.stats.totalMessages).toBe(2);
    expect(result.stats.keptMessages).toBe(3);
  });
});

describe("selectModelMessages — compact+recent mode", () => {
  beforeEach(() => {
    vi.mocked(prisma.document.findUnique).mockReset();
  });

  it("prepends compact summary and keeps last 10 messages verbatim", async () => {
    const history: MessageEntry[] = [];
    for (let i = 0; i < 15; i++) {
      history.push(msg(`m${i}`, i % 2 === 0 ? "user" : "assistant", `msg ${i}`));
    }
    const current = msg("current", "user", "new question");

    vi.mocked(prisma.document.findUnique).mockResolvedValue({
      content: "## Earlier facts\nUser works at Acme.",
    } as any);

    const result = await selectModelMessages({
      workspaceId: "ws1",
      conversationId: "c1",
      history,
      currentMessage: current,
    });

    expect(result.mode).toBe("compact+recent");
    // First message is a leading user-role context block holding the compact.
    // (A system-role message here is silently stripped by convertMessages — see
    // the "compact delivery — survives the convertMessages boundary" test.)
    expect(result.messages[0].role).toBe("user");
    expect(result.messages[0].parts[0].type).toBe("text");
    expect(result.messages[0].parts[0].text).toContain(
      "Earlier in this conversation",
    );
    expect(result.messages[0].parts[0].text).toContain("User works at Acme.");
    // Next 10 are the last 10 of history.
    expect(result.messages.slice(1, 11)).toEqual(history.slice(-10));
    // Last is currentMessage.
    expect(result.messages[11]).toBe(current);
    expect(result.stats.totalMessages).toBe(15);
    expect(result.stats.keptMessages).toBe(12); // compact + 10 recent + current
    expect(result.stats.compactTokens).toBeGreaterThan(0);
  });

  it("falls through to budget-trim when prisma.document.findUnique throws", async () => {
    const history: MessageEntry[] = [];
    for (let i = 0; i < 15; i++) {
      history.push(msg(`m${i}`, i % 2 === 0 ? "user" : "assistant", `msg ${i}`));
    }
    const current = msg("current", "user", "new question");

    vi.mocked(prisma.document.findUnique).mockRejectedValue(
      new Error("db gone"),
    );

    const result = await selectModelMessages({
      workspaceId: "ws1",
      conversationId: "c1",
      history,
      currentMessage: current,
    });
    // Falls through to budget-trim (still works even though no compact).
    expect(result.mode).toBe("budget-trim");
  });
});

describe("compact delivery — survives the convertMessages boundary", () => {
  beforeEach(() => {
    vi.mocked(prisma.document.findUnique).mockReset();
  });

  // Reproduces the exact production chain for a long conversation:
  //   selectModelMessages -> finalMessages -> convertMessages().to("AIV5.Model")
  // (the conversion at services/agent/context.ts:764). selectModelMessages
  // injects the compact as a mid-array role:"system" message; the real system
  // prompt is passed separately as the agent's `instructions`. This test asks
  // the decisive question: does the compact's content actually reach the model?
  it("keeps the compact summary in the model messages after .to('AIV5.Model')", async () => {
    const history: MessageEntry[] = [];
    for (let i = 0; i < 15; i++) {
      history.push(msg(`m${i}`, i % 2 === 0 ? "user" : "assistant", `msg ${i}`));
    }
    const current = msg("current", "user", "what's my deadline again?");

    const COMPACT_MARKER = "Earlier in this conversation";
    const COMPACT_FACT = "User's deadline is March 3rd.";
    vi.mocked(prisma.document.findUnique).mockResolvedValue({
      content: COMPACT_FACT,
    } as any);

    const selection = await selectModelMessages({
      workspaceId: "ws1",
      conversationId: "c1",
      history,
      currentMessage: current,
    });

    // Precondition: the compact is present in selectModelMessages' own output.
    expect(selection.mode).toBe("compact+recent");
    expect(JSON.stringify(selection.messages)).toContain(COMPACT_FACT);

    // The exact conversion buildAgentContext performs before the model call.
    const modelMessages = convertMessages(selection.messages as any).to(
      "AIV5.Model",
    );

    // The decisive assertion: the compact's content must survive into what the
    // model actually receives. If convertMessages strips the mid-array system
    // message, these fail — confirming the compact never reaches the LLM.
    const serialized = JSON.stringify(modelMessages);
    expect(serialized).toContain(COMPACT_FACT);
    expect(serialized).toContain(COMPACT_MARKER);
    // The delivery invariant used at runtime must agree.
    expect(compactSurvivedInModelMessages(modelMessages as any)).toBe(true);
  });
});

describe("compactSurvivedInModelMessages — delivery invariant", () => {
  it("detects the compact across model and UI message shapes", () => {
    const withMarker = `## ${COMPACT_PROMPT_MARKER}\n\nUser lives in Berlin.`;
    // content: string (model shape)
    expect(
      compactSurvivedInModelMessages([{ role: "user", content: withMarker }]),
    ).toBe(true);
    // content: [{ text }] (model shape)
    expect(
      compactSurvivedInModelMessages([
        { role: "user", content: [{ type: "text", text: withMarker }] },
      ]),
    ).toBe(true);
    // parts: [{ text }] (pre-convert UI shape)
    expect(
      compactSurvivedInModelMessages([
        { role: "user", parts: [{ type: "text", text: withMarker }] },
      ]),
    ).toBe(true);
  });

  it("returns false when no message carries the compact", () => {
    expect(
      compactSurvivedInModelMessages([
        { role: "user", content: [{ type: "text", text: "hello" }] },
        { role: "assistant", content: "hi there" },
      ]),
    ).toBe(false);
    expect(compactSurvivedInModelMessages([])).toBe(false);
    expect(compactSurvivedInModelMessages(undefined as any)).toBe(false);
  });
});

describe("parseCoveredUntil", () => {
  it("parses an ISO string and an epoch number; rejects junk/absent", () => {
    const iso = "2026-01-01T00:00:00.000Z";
    expect(parseCoveredUntil({ coveredUntil: iso })).toBe(
      new Date(iso).getTime(),
    );
    expect(parseCoveredUntil({ coveredUntil: 1000 })).toBe(1000);
    expect(parseCoveredUntil({})).toBeNull();
    expect(parseCoveredUntil(null)).toBeNull();
    expect(parseCoveredUntil({ coveredUntil: "not-a-date" })).toBeNull();
  });
});

describe("selectModelMessages — compact+recent watermark tiling (#2)", () => {
  beforeEach(() => {
    vi.mocked(prisma.document.findUnique).mockReset();
  });

  function historyWithTimes(n: number, stepMs = 1_000): MessageEntry[] {
    const h: MessageEntry[] = [];
    for (let i = 0; i < n; i++) {
      h.push({
        id: `m${i}`,
        role: i % 2 === 0 ? "user" : "assistant",
        parts: [{ type: "text", text: `msg ${i}` }],
        createdAt: new Date((i + 1) * stepMs).toISOString(),
      });
    }
    return h;
  }

  it("fast case: watermark past all history → tail is the last RECENT_MESSAGE_WINDOW", async () => {
    const history = historyWithTimes(20); // times 1000..20000
    const current = msg("current", "user", "now");
    vi.mocked(prisma.document.findUnique).mockResolvedValue({
      content: "summary",
      metadata: { coveredUntil: new Date(1_000_000).toISOString() },
    } as any);

    const result = await selectModelMessages({
      workspaceId: "ws1",
      conversationId: "c1",
      history,
      currentMessage: current,
    });

    expect(result.mode).toBe("compact+recent");
    expect(result.messages.slice(1, 11).map((m) => m.id)).toEqual(
      history.slice(-10).map((m) => m.id),
    );
    expect(result.messages.at(-1)).toBe(current);
    expect(result.stats.keptMessages).toBe(12);
  });

  it("lag case: stale watermark bridges the gap → keeps uncovered messages older than the recent window", async () => {
    const history = historyWithTimes(20); // times 1000..20000
    const current = msg("current", "user", "now");
    // Compact only covers through time 6000 (m0..m5). m6..m19 are uncovered.
    vi.mocked(prisma.document.findUnique).mockResolvedValue({
      content: "summary",
      metadata: { coveredUntil: new Date(6_000).toISOString() },
    } as any);

    const result = await selectModelMessages({
      workspaceId: "ws1",
      conversationId: "c1",
      history,
      currentMessage: current,
    });

    expect(result.mode).toBe("compact+recent");
    const verbatimIds = result.messages.slice(1, -1).map((m) => m.id);
    // m6 is older than the last-10 window (m10..m19) yet uncovered → must be kept.
    expect(verbatimIds).toContain("m6");
    expect(verbatimIds[0]).toBe("m6"); // tail starts exactly at the first uncovered
    // m5 is covered by the compact → not also sent verbatim.
    expect(verbatimIds).not.toContain("m5");
    expect(result.messages.at(-1)).toBe(current);
  });

  it("missing watermark (pre-#2 docs): falls back to the last RECENT_MESSAGE_WINDOW", async () => {
    const history = historyWithTimes(20);
    const current = msg("current", "user", "now");
    vi.mocked(prisma.document.findUnique).mockResolvedValue({
      content: "summary", // no metadata
    } as any);

    const result = await selectModelMessages({
      workspaceId: "ws1",
      conversationId: "c1",
      history,
      currentMessage: current,
    });

    expect(result.mode).toBe("compact+recent");
    expect(result.messages.slice(1, 11).map((m) => m.id)).toEqual(
      history.slice(-10).map((m) => m.id),
    );
    expect(result.stats.coveredUntil).toBeNull();
  });

  it("budget cap: trims oldest of the bridged tail and alarms when dropping uncovered messages", async () => {
    const errorSpy = vi
      .spyOn(logger, "error")
      .mockImplementation(() => undefined as any);
    // 20 big messages (~5k tokens each), all uncovered (watermark covers nothing).
    const history: MessageEntry[] = [];
    for (let i = 0; i < 20; i++) {
      history.push({
        id: `m${i}`,
        role: i % 2 === 0 ? "user" : "assistant",
        parts: [{ type: "text", text: "x".repeat(20_000) }],
        createdAt: new Date((i + 1) * 1_000).toISOString(),
      });
    }
    const current = msg("current", "user", "now");
    vi.mocked(prisma.document.findUnique).mockResolvedValue({
      content: "summary",
      metadata: { coveredUntil: new Date(1).toISOString() },
    } as any);

    const result = await selectModelMessages({
      workspaceId: "ws1",
      conversationId: "c1",
      history,
      currentMessage: current,
    });

    expect(result.mode).toBe("compact+recent");
    const verbatimIds = result.messages.slice(1, -1).map((m) => m.id);
    expect(verbatimIds.length).toBeLessThan(20); // capped
    expect(verbatimIds.length).toBeGreaterThan(0);
    expect(verbatimIds).toContain("m19"); // newest kept
    expect(verbatimIds).not.toContain("m0"); // oldest dropped
    expect(errorSpy).toHaveBeenCalled(); // dropped messages were uncovered → gap alarm
    errorSpy.mockRestore();
  });
});

describe("selectModelMessages — budget-trim mode", () => {
  beforeEach(() => {
    vi.mocked(prisma.document.findUnique).mockReset();
  });

  it("walks backward keeping messages that fit under 40k tokens", async () => {
    vi.mocked(prisma.document.findUnique).mockResolvedValue(null);

    const history: MessageEntry[] = [];
    for (let i = 0; i < 15; i++) {
      history.push(msg(`m${i}`, i % 2 === 0 ? "user" : "assistant", `msg ${i}`));
    }
    const current = msg("current", "user", "new question");

    const result = await selectModelMessages({
      workspaceId: "ws1",
      conversationId: "c1",
      history,
      currentMessage: current,
    });

    expect(result.mode).toBe("budget-trim");
    expect(result.stats.compactTokens).toBeNull();
    // Newest messages preserved chronologically, current is last.
    expect(result.messages[result.messages.length - 1]).toBe(current);
    // All messages are small, so nothing should be dropped.
    expect(result.stats.keptMessages).toBe(16);
  });

  it("always includes current message even if it alone exceeds budget", async () => {
    vi.mocked(prisma.document.findUnique).mockResolvedValue(null);

    const history: MessageEntry[] = [
      msg("m0", "user", "short"),
      msg("m1", "assistant", "reply"),
      msg("m2", "user", "short again"),
      msg("m3", "assistant", "ok"),
      msg("m4", "user", "one more"),
      msg("m5", "assistant", "sure"),
      msg("m6", "user", "yes"),
      msg("m7", "assistant", "fine"),
      msg("m8", "user", "good"),
      msg("m9", "assistant", "great"),
      msg("m10", "user", "cool"),
    ];
    // Current message is enormous.
    const current: MessageEntry = {
      id: "big",
      role: "user",
      parts: [{ type: "text", text: "x".repeat(300_000) }], // ~75k tokens
    };

    const result = await selectModelMessages({
      workspaceId: "ws1",
      conversationId: "c1",
      history,
      currentMessage: current,
    });

    expect(result.mode).toBe("budget-trim");
    // Current must be included.
    expect(result.messages.at(-1)).toBe(current);
    // Older messages pruned because current ate the budget.
    expect(result.stats.keptMessages).toBeLessThan(history.length + 1);
  });

  it("drops oldest messages when history exceeds budget", async () => {
    vi.mocked(prisma.document.findUnique).mockResolvedValue(null);

    const history: MessageEntry[] = [];
    // 20 messages, each ~5000 tokens (20_000 chars) → 100k total, > 40k budget.
    for (let i = 0; i < 20; i++) {
      history.push(msg(`m${i}`, i % 2 === 0 ? "user" : "assistant", "x".repeat(20_000)));
    }
    const current = msg("current", "user", "small current");

    const result = await selectModelMessages({
      workspaceId: "ws1",
      conversationId: "c1",
      history,
      currentMessage: current,
    });

    expect(result.mode).toBe("budget-trim");
    expect(result.stats.totalMessages).toBe(20);
    expect(result.stats.keptMessages).toBeLessThan(20);
    // Newest history messages preferred.
    const keptHistoryIds = result.messages
      .filter((m) => m.id !== "current")
      .map((m) => m.id);
    expect(keptHistoryIds).toContain("m19");
    expect(keptHistoryIds).not.toContain("m0");
  });
});

function makeFakeAgent(impl: (messages: any[]) => Promise<any>) {
  return {
    generate: vi.fn(impl),
  } as unknown as import("@mastra/core/agent").Agent;
}

describe("generateWithRetry", () => {
  it("returns result on first-try success with no retries", async () => {
    const agent = makeFakeAgent(async () => ({ text: "hello", steps: [] }));
    const result = await generateWithRetry({
      agent,
      modelMessages: [
        { role: "user", parts: [{ type: "text", text: "hi" }] },
      ],
      generateOptions: {},
      conversationId: "c1",
    });
    expect(result.text).toBe("hello");
    expect((agent.generate as any).mock.calls.length).toBe(1);
  });

  it("retries on context-length error, dropping the oldest round", async () => {
    let callCount = 0;
    const calledWith: any[][] = [];
    const agent = makeFakeAgent(async (messages) => {
      callCount++;
      calledWith.push(messages);
      if (callCount === 1) {
        throw new Error("context_length_exceeded: too many tokens");
      }
      return { text: "recovered", steps: [] };
    });

    const modelMessages = [
      { role: "system", parts: [{ type: "text", text: "sys" }] },
      { role: "user", parts: [{ type: "text", text: "first" }] },
      { role: "assistant", parts: [{ type: "text", text: "first reply" }] },
      { role: "user", parts: [{ type: "text", text: "second" }] },
      { role: "assistant", parts: [{ type: "text", text: "second reply" }] },
      { role: "user", parts: [{ type: "text", text: "current" }] },
    ];

    const result = await generateWithRetry({
      agent,
      modelMessages,
      generateOptions: {},
      conversationId: "c1",
    });

    expect(result.text).toBe("recovered");
    expect(callCount).toBe(2);
    // Retry dropped the oldest user+assistant pair; system and current remain.
    const second = calledWith[1];
    expect(second[0].role).toBe("system");
    expect(second.at(-1).parts[0].text).toBe("current");
    expect(second.length).toBe(modelMessages.length - 2);
  });

  it("gives up after CONTEXT_RETRY_MAX retries on context-length errors", async () => {
    const agent = makeFakeAgent(async () => {
      throw new Error("prompt is too long");
    });

    const modelMessages = [
      { role: "user", parts: [{ type: "text", text: "u1" }] },
      { role: "assistant", parts: [{ type: "text", text: "a1" }] },
      { role: "user", parts: [{ type: "text", text: "u2" }] },
      { role: "assistant", parts: [{ type: "text", text: "a2" }] },
      { role: "user", parts: [{ type: "text", text: "u3" }] },
      { role: "assistant", parts: [{ type: "text", text: "a3" }] },
      { role: "user", parts: [{ type: "text", text: "current" }] },
    ];

    await expect(
      generateWithRetry({
        agent,
        modelMessages,
        generateOptions: {},
        conversationId: "c1",
      }),
    ).rejects.toThrow(/prompt is too long/);
    // Initial call + 2 retries = 3.
    expect((agent.generate as any).mock.calls.length).toBe(3);
  });

  it("does not retry non-context-length errors", async () => {
    const agent = makeFakeAgent(async () => {
      throw new Error("Some other failure");
    });
    await expect(
      generateWithRetry({
        agent,
        modelMessages: [{ role: "user", parts: [{ type: "text", text: "x" }] }],
        generateOptions: {},
        conversationId: "c1",
      }),
    ).rejects.toThrow(/Some other failure/);
    expect((agent.generate as any).mock.calls.length).toBe(1);
  });

  it("never drops the first (system) or last (current) message", async () => {
    let callCount = 0;
    const calledWith: any[][] = [];
    const agent = makeFakeAgent(async (messages) => {
      callCount++;
      calledWith.push(messages);
      if (callCount <= 2) throw new Error("context length exceeded");
      return { text: "ok", steps: [] };
    });

    const modelMessages = [
      { role: "system", parts: [{ type: "text", text: "sys" }] },
      { role: "user", parts: [{ type: "text", text: "u1" }] },
      { role: "assistant", parts: [{ type: "text", text: "a1" }] },
      { role: "user", parts: [{ type: "text", text: "u2" }] },
      { role: "assistant", parts: [{ type: "text", text: "a2" }] },
      { role: "user", parts: [{ type: "text", text: "current" }] },
    ];

    await generateWithRetry({
      agent,
      modelMessages,
      generateOptions: {},
      conversationId: "c1",
    });

    for (const call of calledWith) {
      expect(call[0].role).toBe("system");
      expect(call.at(-1).parts[0].text).toBe("current");
    }
  });

  it("pins the compact summary across context-length retries (never drops it)", async () => {
    const compactText = `## ${COMPACT_PROMPT_MARKER}\n\nUser's flight is on Friday.`;
    let callCount = 0;
    const calledWith: any[][] = [];
    const agent = makeFakeAgent(async (messages) => {
      callCount++;
      calledWith.push(messages);
      if (callCount <= 2) throw new Error("context length exceeded");
      return { text: "ok", steps: [] };
    });

    // Mirrors compact+recent after convertMessages: a leading USER-role compact
    // (no system message), then real rounds, then the current turn.
    const modelMessages = [
      { role: "user", content: [{ type: "text", text: compactText }] },
      { role: "user", content: [{ type: "text", text: "u1" }] },
      { role: "assistant", content: [{ type: "text", text: "a1" }] },
      { role: "user", content: [{ type: "text", text: "u2" }] },
      { role: "assistant", content: [{ type: "text", text: "a2" }] },
      { role: "user", content: [{ type: "text", text: "current" }] },
    ];

    await generateWithRetry({
      agent,
      modelMessages,
      generateOptions: {},
      conversationId: "c1",
    });

    expect(callCount).toBe(3);
    // The compact must survive every attempt and stay at the front; the current
    // turn must always be last. Oldest *real* rounds are dropped instead.
    for (const call of calledWith) {
      expect(compactSurvivedInModelMessages(call)).toBe(true);
      expect(call[0].content[0].text).toContain(COMPACT_PROMPT_MARKER);
      expect(call.at(-1).content[0].text).toBe("current");
    }
    expect(calledWith[2].length).toBeLessThan(modelMessages.length);
  });
});
