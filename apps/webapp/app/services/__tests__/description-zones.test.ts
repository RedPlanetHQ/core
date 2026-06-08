import { describe, expect, it } from "vitest";
import { mergeStructuredSections } from "~/services/coding-task.server";

// Helper: build a doc node from a list of structured zones + optional prose.
type Doc = { type: string; content: Node[] };
type Node = { type: string; content?: Node[]; text?: string };

const para = (text: string): Node => ({
  type: "paragraph",
  content: [{ type: "text", text }],
});

const zone = (type: "plan" | "outcome" | "log", paragraphs: string[]): Node => ({
  type,
  content: paragraphs.map(para),
});

const doc = (...children: Node[]): Doc => ({ type: "doc", content: children });

// Pull the text out of a zone's paragraphs so assertions stay readable.
function textsIn(node: Node): string[] {
  return (node.content ?? []).map(
    (p) => (p.content?.[0] as Node | undefined)?.text ?? "",
  );
}

function findZone(d: Doc, type: string): Node | undefined {
  return d.content.find((n) => n.type === type);
}

function findAllZones(d: Doc, type: string): Node[] {
  return d.content.filter((n) => n.type === type);
}

describe("mergeStructuredSections — <plan>/<outcome> REPLACE semantics", () => {
  it("replaces existing <plan> content in place when input has <plan>", () => {
    const existing = doc(
      para("user prose above"),
      zone("plan", ["old step 1", "old step 2"]),
      para("user prose below"),
    );
    const input = doc(zone("plan", ["new step"]));

    const merged = mergeStructuredSections(existing, input) as Doc;

    expect(merged.content).toHaveLength(3);
    expect(merged.content[0].type).toBe("paragraph");
    expect(merged.content[1].type).toBe("plan");
    expect(merged.content[2].type).toBe("paragraph");
    expect(textsIn(merged.content[1])).toEqual(["new step"]);
  });

  it("appends <plan> at end if none exists", () => {
    const existing = doc(para("user prose"));
    const input = doc(zone("plan", ["a plan"]));

    const merged = mergeStructuredSections(existing, input) as Doc;

    expect(merged.content).toHaveLength(2);
    expect(merged.content[1].type).toBe("plan");
    expect(textsIn(merged.content[1])).toEqual(["a plan"]);
  });

  it("replaces <outcome> in place, leaves <plan> untouched", () => {
    const existing = doc(
      zone("plan", ["the plan stays"]),
      zone("outcome", ["old outcome"]),
    );
    const input = doc(zone("outcome", ["new outcome"]));

    const merged = mergeStructuredSections(existing, input) as Doc;

    expect(textsIn(findZone(merged, "plan")!)).toEqual(["the plan stays"]);
    expect(textsIn(findZone(merged, "outcome")!)).toEqual(["new outcome"]);
  });

  it("updates plan AND outcome in a single call when both present in input", () => {
    const existing = doc(
      zone("plan", ["old plan"]),
      zone("outcome", ["old outcome"]),
    );
    const input = doc(
      zone("plan", ["new plan"]),
      zone("outcome", ["new outcome"]),
    );

    const merged = mergeStructuredSections(existing, input) as Doc;

    expect(textsIn(findZone(merged, "plan")!)).toEqual(["new plan"]);
    expect(textsIn(findZone(merged, "outcome")!)).toEqual(["new outcome"]);
  });
});

describe("mergeStructuredSections — <log> APPEND semantics", () => {
  it("appends children to existing <log> instead of replacing", () => {
    const existing = doc(zone("log", ["day 1: 3 emails"]));
    const input = doc(zone("log", ["day 2: 5 emails"]));

    const merged = mergeStructuredSections(existing, input) as Doc;

    const log = findZone(merged, "log")!;
    expect(textsIn(log)).toEqual(["day 1: 3 emails", "day 2: 5 emails"]);
  });

  it("accumulates across many sequential appends (the recurring task case)", () => {
    let acc = doc(para("user-authored brief"));
    for (let i = 1; i <= 7; i++) {
      acc = mergeStructuredSections(acc, doc(zone("log", [`day ${i}`]))) as Doc;
    }

    const log = findZone(acc, "log")!;
    expect(textsIn(log)).toEqual([
      "day 1",
      "day 2",
      "day 3",
      "day 4",
      "day 5",
      "day 6",
      "day 7",
    ]);
    // User prose untouched
    expect(acc.content[0].type).toBe("paragraph");
    expect((acc.content[0].content?.[0] as Node | undefined)?.text).toBe(
      "user-authored brief",
    );
  });

  it("inserts new <log> at end when none exists", () => {
    const existing = doc(
      para("user prose"),
      zone("plan", ["the plan"]),
    );
    const input = doc(zone("log", ["first entry"]));

    const merged = mergeStructuredSections(existing, input) as Doc;

    expect(merged.content).toHaveLength(3);
    expect(merged.content[2].type).toBe("log");
    expect(textsIn(merged.content[2])).toEqual(["first entry"]);
    // Plan untouched
    expect(textsIn(findZone(merged, "plan")!)).toEqual(["the plan"]);
  });

  it("does not affect <plan> or <outcome> when only <log> is in input", () => {
    const existing = doc(
      zone("plan", ["the plan"]),
      zone("outcome", ["the outcome"]),
      zone("log", ["entry 1"]),
    );
    const input = doc(zone("log", ["entry 2"]));

    const merged = mergeStructuredSections(existing, input) as Doc;

    expect(textsIn(findZone(merged, "plan")!)).toEqual(["the plan"]);
    expect(textsIn(findZone(merged, "outcome")!)).toEqual(["the outcome"]);
    expect(textsIn(findZone(merged, "log")!)).toEqual(["entry 1", "entry 2"]);
  });

  it("can append to <log> AND replace <outcome> in one call", () => {
    const existing = doc(
      zone("log", ["mon", "tue", "wed"]),
      zone("outcome", ["old summary"]),
    );
    const input = doc(
      zone("log", ["thu"]),
      zone("outcome", ["new summary"]),
    );

    const merged = mergeStructuredSections(existing, input) as Doc;

    expect(textsIn(findZone(merged, "log")!)).toEqual([
      "mon",
      "tue",
      "wed",
      "thu",
    ]);
    expect(textsIn(findZone(merged, "outcome")!)).toEqual(["new summary"]);
  });
});

describe("mergeStructuredSections — input validation", () => {
  it("throws when input has two <plan> nodes", () => {
    const existing = doc();
    const input = doc(zone("plan", ["a"]), zone("plan", ["b"]));

    expect(() => mergeStructuredSections(existing, input)).toThrow(
      /at most one <plan>/,
    );
  });

  it("throws when input has two <log> nodes", () => {
    const existing = doc();
    const input = doc(zone("log", ["a"]), zone("log", ["b"]));

    expect(() => mergeStructuredSections(existing, input)).toThrow(
      /at most one <log>/,
    );
  });

  it("throws when input has two <outcome> nodes", () => {
    const existing = doc();
    const input = doc(zone("outcome", ["a"]), zone("outcome", ["b"]));

    expect(() => mergeStructuredSections(existing, input)).toThrow(
      /at most one <outcome>/,
    );
  });
});

describe("mergeStructuredSections — user content preservation", () => {
  it("drops non-structured input nodes (e.g. paragraphs)", () => {
    const existing = doc(para("user prose"));
    const input = doc(
      para("agent's casual text — should be ignored"),
      zone("plan", ["the plan"]),
    );

    const merged = mergeStructuredSections(existing, input) as Doc;

    // Only the original user prose + the new <plan> survive.
    expect(merged.content).toHaveLength(2);
    expect(merged.content[0].type).toBe("paragraph");
    expect((merged.content[0].content?.[0] as Node).text).toBe("user prose");
    expect(merged.content[1].type).toBe("plan");
  });

  it("preserves user prose position when replacing a zone", () => {
    const existing = doc(
      para("intro from user"),
      zone("plan", ["v1"]),
      para("user note between zones"),
      zone("outcome", ["v1 outcome"]),
      para("user footer"),
    );
    const input = doc(
      zone("plan", ["v2"]),
      zone("outcome", ["v2 outcome"]),
    );

    const merged = mergeStructuredSections(existing, input) as Doc;

    expect(merged.content.map((n) => n.type)).toEqual([
      "paragraph",
      "plan",
      "paragraph",
      "outcome",
      "paragraph",
    ]);
    expect((merged.content[0].content?.[0] as Node).text).toBe(
      "intro from user",
    );
    expect((merged.content[2].content?.[0] as Node).text).toBe(
      "user note between zones",
    );
    expect((merged.content[4].content?.[0] as Node).text).toBe("user footer");
  });

  it("does NOT dedupe pre-existing duplicate zones (only first match is touched)", () => {
    // Edge case: the merger replaces/appends into the FIRST matching node.
    // If a doc already has two <plan>s (weird but possible), the second is
    // left as-is. Documenting this so future changes don't quietly alter it.
    const existing = doc(
      zone("plan", ["first plan"]),
      zone("plan", ["second plan"]),
    );
    const input = doc(zone("plan", ["new"]));

    const merged = mergeStructuredSections(existing, input) as Doc;

    const plans = findAllZones(merged, "plan");
    expect(plans).toHaveLength(2);
    expect(textsIn(plans[0])).toEqual(["new"]);
    expect(textsIn(plans[1])).toEqual(["second plan"]);
  });
});
