import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

/**
 * Structural tests verifying the frontend stop button wiring.
 *
 * Full React component tests would require jsdom + mocking @ai-sdk/react,
 * which is heavy for this fix. These tests validate the critical code
 * changes that make the stop button work:
 *
 * 1. handleStop calls both stop() and the /stop endpoint
 * 2. The stop prop is wired to handleStop (not the raw stop())
 */

describe("ConversationView stop button wiring", () => {
  const componentPath = resolve(
    __dirname,
    "../conversation-view.client.tsx",
  );
  const source = readFileSync(componentPath, "utf-8");

  it("defines handleStop callback", () => {
    expect(source).toContain("const handleStop = useCallback(");
  });

  it("handleStop calls useChat stop()", () => {
    // The stop() call should be inside handleStop
    const handleStopBlock = source.match(
      /const handleStop = useCallback\(\(\) => \{[\s\S]*?\}, \[/,
    );
    expect(handleStopBlock).not.toBeNull();
    expect(handleStopBlock![0]).toContain("stop()");
  });

  it("handleStop calls the stop endpoint", () => {
    const handleStopBlock = source.match(
      /const handleStop = useCallback\(\(\) => \{[\s\S]*?\}, \[/,
    );
    expect(handleStopBlock).not.toBeNull();
    expect(handleStopBlock![0]).toContain("/stop");
    expect(handleStopBlock![0]).toContain('method: "POST"');
  });

  it("passes handleStop to ConversationTextarea (not raw stop)", () => {
    // Should use stop={handleStop}, NOT stop={() => stop()}
    expect(source).toContain("stop={handleStop}");
    expect(source).not.toContain("stop={() => stop()}");
  });

  it("handleStop depends on conversationId for correct URL", () => {
    expect(source).toMatch(/\[stop,\s*conversationId\]/);
  });
});
