import { describe, expect, it } from "vitest";
import {
  truncateString,
  truncateToolResult,
} from "~/services/agent/tools/truncate-result";

// truncateString

describe("truncateString", () => {
  it("returns input unchanged when under the limit", () => {
    const input = "short string";
    const { content, info } = truncateString(input, { maxBytes: 100 });
    expect(content).toBe(input);
    expect(info.truncated).toBe(false);
    expect(info.totalBytes).toBe(input.length);
    expect(info.emittedBytes).toBe(input.length);
  });

  it("returns input unchanged when exactly at the limit", () => {
    const input = "x".repeat(100);
    const { content, info } = truncateString(input, { maxBytes: 100 });
    expect(content).toBe(input);
    expect(info.truncated).toBe(false);
  });

  it("truncates when input exceeds the limit", () => {
    const input = "a".repeat(200);
    const { content, info } = truncateString(input, { maxBytes: 100 });
    expect(info.truncated).toBe(true);
    expect(info.totalBytes).toBe(200);
    // Head = floor(100 * 0.3) = 30, Tail = 70
    expect(info.emittedBytes).toBe(100);
    // Content should have the top banner + head + marker + tail
    expect(content).toContain("[TRUNCATED");
    expect(content).toContain("omitted");
  });

  it("applies 30:70 head:tail ratio", () => {
    const input = "abcdefghij".repeat(20); // 200 chars
    const { content } = truncateString(input, { maxBytes: 100 });
    // Head = 30 chars, Tail = 70 chars
    const headLen = Math.floor(100 * 0.3); // 30
    const tailLen = 100 - headLen; // 70
    // The head portion of the original string should be in the output
    expect(content).toContain(input.slice(0, headLen));
    // The tail portion of the original string should be in the output
    expect(content).toContain(input.slice(input.length - tailLen));
  });

  it("uses default label 'output' when none specified", () => {
    const input = "x".repeat(200);
    const { content } = truncateString(input, { maxBytes: 100 });
    expect(content).toContain("[TRUNCATED output:");
  });

  it("uses custom label in the marker", () => {
    const input = "x".repeat(200);
    const { content } = truncateString(input, {
      maxBytes: 100,
      label: "stdout",
    });
    expect(content).toContain("[TRUNCATED stdout:");
    expect(content).toContain("[stdout truncated:");
  });

  it("includes hint text in the marker", () => {
    const input = "x".repeat(200);
    const { content } = truncateString(input, {
      maxBytes: 100,
      hint: "Re-run with grep",
    });
    expect(content).toContain("Re-run with grep");
  });

  it("omits hint clause when no hint is provided", () => {
    const input = "x".repeat(200);
    const { content } = truncateString(input, { maxBytes: 100 });
    // The marker should end with "] ..." and not have a trailing hint
    expect(content).toMatch(/omitted, .+ total\.\]/);
  });

  it("formats byte counts as KB for kilobyte-range drops", () => {
    const input = "x".repeat(5000);
    const { content } = truncateString(input, { maxBytes: 1000 });
    expect(content).toMatch(/KB/);
  });

  it("uses default maxBytes (128 KB) when not specified", () => {
    // A string under 128KB should not be truncated
    const underLimit = "x".repeat(128 * 1024);
    const { info: underInfo } = truncateString(underLimit);
    expect(underInfo.truncated).toBe(false);

    // A string over 128KB should be truncated
    const overLimit = "x".repeat(128 * 1024 + 1);
    const { info: overInfo } = truncateString(overLimit);
    expect(overInfo.truncated).toBe(true);
  });
});

// truncateToolResult

describe("truncateToolResult", () => {
  it("serializes and returns small objects unchanged", () => {
    const result = truncateToolResult({ status: "ok", count: 42 });
    expect(result).toContain('"status": "ok"');
    expect(result).toContain('"count": 42');
  });

  it("truncates large serialized objects", () => {
    const bigObject = { data: "x".repeat(200_000) };
    const result = truncateToolResult(bigObject, { maxBytes: 1000 });
    expect(result).toContain("[TRUNCATED");
  });

  it("uses 'tool result' as default label", () => {
    const bigObject = { data: "x".repeat(200_000) };
    const result = truncateToolResult(bigObject, { maxBytes: 1000 });
    expect(result).toContain("tool result");
  });

  it("uses custom label when provided", () => {
    const bigObject = { data: "x".repeat(200_000) };
    const result = truncateToolResult(bigObject, {
      maxBytes: 1000,
      label: "api response",
    });
    expect(result).toContain("api response");
  });

  it("returns error string for circular references", () => {
    const obj: Record<string, unknown> = { name: "loop" };
    obj.self = obj;
    const result = truncateToolResult(obj);
    expect(result).toMatch(/^ERROR: failed to serialize tool result/);
    expect(result).toContain("circular");
  });

  it("handles null input gracefully", () => {
    const result = truncateToolResult(null);
    expect(result).toBe("null");
  });

  it("handles undefined input gracefully", () => {
    // JSON.stringify(undefined) returns undefined (not "undefined"),
    // but the ?? "" fallback in truncateToolResult handles it
    const result = truncateToolResult(undefined);
    // Should not throw
    expect(typeof result).toBe("string");
  });

  it("serializes without pretty-printing when pretty=false", () => {
    const result = truncateToolResult({ a: 1, b: 2 }, { pretty: false });
    // Compact JSON has no newlines or indentation
    expect(result).not.toContain("\n");
    expect(result).toContain('{"a":1,"b":2}');
  });

  it("includes default hint about narrower slice in truncated output", () => {
    const bigObject = { data: "x".repeat(200_000) };
    const result = truncateToolResult(bigObject, { maxBytes: 1000 });
    expect(result).toContain("narrower slice");
  });

  it("uses custom hint when provided", () => {
    const bigObject = { data: "x".repeat(200_000) };
    const result = truncateToolResult(bigObject, {
      maxBytes: 1000,
      hint: "Try filtering by date",
    });
    expect(result).toContain("Try filtering by date");
  });
});
