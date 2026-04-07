import { describe, it, expect, vi } from "vitest";

/**
 * Focused unit test verifying that request.signal is wired through to
 * agent.stream() as abortSignal, and that aborting marks the conversation
 * as completed.
 *
 * Because the conversation route has many heavy dependencies (Mastra, Prisma,
 * LLM providers), this test validates the critical wiring in isolation by
 * reading the source and asserting on the code structure. For integration
 * testing, use a running dev server.
 */

import { readFileSync } from "fs";
import { resolve } from "path";

describe("api.v1.conversation._index abort signal wiring", () => {
  const routePath = resolve(
    __dirname,
    "../../routes/api.v1.conversation._index.tsx",
  );
  const source = readFileSync(routePath, "utf-8");

  it("destructures request from handler args", () => {
    expect(source).toMatch(/async\s*\(\{[^}]*request[^}]*\}\)/);
  });

  it("extracts abortSignal from request.signal", () => {
    expect(source).toContain("const abortSignal = request.signal");
  });

  it("passes abortSignal to agent.stream()", () => {
    // Should appear inside the agent.stream() options object
    const streamCallMatch = source.match(
      /agent\.stream\([\s\S]*?\{[\s\S]*?abortSignal[\s\S]*?\}\)/,
    );
    expect(streamCallMatch).not.toBeNull();
  });

  it("listens for abort event to update conversation status", () => {
    expect(source).toContain('abortSignal.addEventListener');
    expect(source).toContain('"abort"');
    expect(source).toMatch(
      /updateConversationStatus\(body\.id,\s*"completed"\)/,
    );
  });

  it("uses { once: true } to avoid listener leaks", () => {
    expect(source).toContain("{ once: true }");
  });
});
