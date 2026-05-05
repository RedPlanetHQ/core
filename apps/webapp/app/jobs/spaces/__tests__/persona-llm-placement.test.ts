import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/services/logger.service", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}));
vi.mock("~/lib/model.server", () => ({
  createAgent: vi.fn(),
  resolveModelString: vi.fn(),
}));

import {
  PlacementDecisionSchema,
  type PlacementDecision,
  buildPlacementPrompt,
  buildBatchPlacementPrompt,
  placeFactInPersona,
  placeFactsInPersona,
} from "../persona-llm-placement";
import { createAgent, resolveModelString } from "~/lib/model.server";

describe("PlacementDecisionSchema", () => {
  it("accepts skip variant", () => {
    const ok = PlacementDecisionSchema.safeParse({
      decision: "skip",
      reason: "one-off, not a standing rule",
    });
    expect(ok.success).toBe(true);
  });

  it("accepts append_to_subsection variant", () => {
    const ok = PlacementDecisionSchema.safeParse({
      decision: "append_to_subsection",
      subsection: "Email writing",
      bullet: "Avoids 'thanks in advance'",
    });
    expect(ok.success).toBe(true);
  });

  it("accepts promote_to_new_subsection variant with required fields", () => {
    const ok = PlacementDecisionSchema.safeParse({
      decision: "promote_to_new_subsection",
      subsection: "Styling",
      prose: "Uses Tailwind plus shadcn/ui with CSS variables for theming.",
      bullets: ["Always uses Tailwind"],
      promoted_loose_ids: ["L1", "L2"],
    });
    expect(ok.success).toBe(true);
  });

  it("accepts add_to_loose_facts variant", () => {
    const ok = PlacementDecisionSchema.safeParse({
      decision: "add_to_loose_facts",
      bullet: "Prefers ripgrep",
    });
    expect(ok.success).toBe(true);
  });

  it("rejects unknown decision values", () => {
    const bad = PlacementDecisionSchema.safeParse({
      decision: "modify_existing",
      subsection: "X",
      bullet: "Y",
    });
    expect(bad.success).toBe(false);
  });

  it("rejects promote_to_new_subsection with empty bullets", () => {
    const bad = PlacementDecisionSchema.safeParse({
      decision: "promote_to_new_subsection",
      subsection: "X",
      prose: "Prose.",
      bullets: [],
      promoted_loose_ids: ["L1"],
    });
    expect(bad.success).toBe(false);
  });

  it("rejects promote_to_new_subsection with empty promoted_loose_ids", () => {
    const bad = PlacementDecisionSchema.safeParse({
      decision: "promote_to_new_subsection",
      subsection: "X",
      prose: "Prose.",
      bullets: ["one"],
      promoted_loose_ids: [],
    });
    expect(bad.success).toBe(false);
  });

  it("typed PlacementDecision union works at type level", () => {
    const d: PlacementDecision = { decision: "skip", reason: "test" };
    expect(d.decision).toBe("skip");
  });
});

describe("buildPlacementPrompt", () => {
  const baseInput = {
    aspect: "Preference" as const,
    fact: "User prefers Tailwind for all styling",
    filterGuidance:
      "Include style preferences. Exclude one-off project decisions.",
  };

  it("includes the new fact verbatim", () => {
    const prompt = buildPlacementPrompt({
      ...baseInput,
      structure: { subsections: [], looseFacts: [] },
    });
    expect(prompt).toContain("User prefers Tailwind for all styling");
  });

  it("never includes existing bullet text from input — only structure summary", () => {
    const prompt = buildPlacementPrompt({
      ...baseInput,
      structure: {
        subsections: [
          {
            name: "Email writing",
            proseFirstSentence: "Keeps emails brief, opens with the ask.",
            bulletCount: 4,
          },
        ],
        looseFacts: [{ id: "L1", text: "Prefers Vim bindings" }],
      },
    });
    expect(prompt).toContain("Email writing");
    expect(prompt).toContain("Keeps emails brief, opens with the ask.");
    expect(prompt).toContain("4 bullets");
    expect(prompt).toContain("L1");
    expect(prompt).toContain("Prefers Vim bindings");
  });

  it("includes the four-variant decision rubric and JSON-only constraint", () => {
    const prompt = buildPlacementPrompt({
      ...baseInput,
      structure: { subsections: [], looseFacts: [] },
    });
    expect(prompt).toContain("skip");
    expect(prompt).toContain("append_to_subsection");
    expect(prompt).toContain("promote_to_new_subsection");
    expect(prompt).toContain("add_to_loose_facts");
    expect(prompt).toContain("JSON");
  });

  it("scales bounded with section size — large structures don't blow context", () => {
    const big = {
      subsections: Array.from({ length: 20 }, (_, i) => ({
        name: `Topic ${i}`,
        proseFirstSentence: `Sentence ${i}.`,
        bulletCount: 50,
      })),
      looseFacts: Array.from({ length: 50 }, (_, i) => ({
        id: `L${i + 1}`,
        text: `Loose ${i}`,
      })),
    };
    const prompt = buildPlacementPrompt({
      ...baseInput,
      structure: big,
    });
    expect(prompt.length).toBeLessThan(20_000);
  });
});

describe("placeFactInPersona", () => {
  const mockGenerate = vi.fn();
  const baseInput = {
    aspect: "Preference" as const,
    fact: "Always uses Tailwind",
    filterGuidance: "Include style preferences.",
    structure: { subsections: [], looseFacts: [] },
  };

  beforeEach(() => {
    mockGenerate.mockReset();
    (resolveModelString as any).mockResolvedValue("test-model");
    (createAgent as any).mockReturnValue({ generate: mockGenerate });
  });

  it("returns parsed decision when LLM emits valid JSON", async () => {
    mockGenerate.mockResolvedValue({
      text: JSON.stringify({
        decision: "add_to_loose_facts",
        bullet: "Always uses Tailwind",
      }),
    });
    const result = await placeFactInPersona(baseInput);
    expect(result).toEqual({
      decision: "add_to_loose_facts",
      bullet: "Always uses Tailwind",
    });
  });

  it("returns null when LLM emits invalid JSON", async () => {
    mockGenerate.mockResolvedValue({ text: "not json" });
    const result = await placeFactInPersona(baseInput);
    expect(result).toBeNull();
  });

  it("returns null when LLM emits a shape Zod rejects", async () => {
    mockGenerate.mockResolvedValue({
      text: JSON.stringify({
        decision: "modify_existing",
        bullet: "x",
      }),
    });
    const result = await placeFactInPersona(baseInput);
    expect(result).toBeNull();
  });

  it("returns null when LLM throws", async () => {
    mockGenerate.mockRejectedValue(new Error("api down"));
    const result = await placeFactInPersona(baseInput);
    expect(result).toBeNull();
  });
});

describe("buildBatchPlacementPrompt", () => {
  it("includes all facts and the episode body when provided", () => {
    const prompt = buildBatchPlacementPrompt({
      aspect: "Preference",
      facts: ["Uses bun", "Pins bun in CI"],
      filterGuidance: "Include style preferences.",
      structure: { subsections: [], looseFacts: [] },
      episodeContent: "User said: switched to bun last week.",
    });
    expect(prompt).toContain("Uses bun");
    expect(prompt).toContain("Pins bun in CI");
    expect(prompt).toContain("switched to bun last week");
    expect(prompt).toContain("JSON ARRAY");
  });

  it("omits the episode block when episodeContent is undefined", () => {
    const prompt = buildBatchPlacementPrompt({
      aspect: "Preference",
      facts: ["Uses bun"],
      filterGuidance: "x",
      structure: { subsections: [], looseFacts: [] },
    });
    expect(prompt).not.toContain("SOURCE EPISODE");
  });
});

describe("placeFactsInPersona", () => {
  const mockGenerate = vi.fn();
  const baseInput = {
    aspect: "Preference" as const,
    facts: ["Uses bun", "Pins bun in CI"],
    filterGuidance: "Include style preferences.",
    structure: { subsections: [], looseFacts: [] },
  };

  beforeEach(() => {
    mockGenerate.mockReset();
    (resolveModelString as any).mockResolvedValue("test-model");
    (createAgent as any).mockReturnValue({ generate: mockGenerate });
  });

  it("returns ordered decisions for a valid JSON array", async () => {
    mockGenerate.mockResolvedValue({
      text: JSON.stringify([
        {
          decision: "promote_to_new_subsection",
          subsection: "Package manager",
          prose: "Standardised on bun across local and CI.",
          bullets: ["Uses bun", "Pins bun in CI"],
          promoted_loose_ids: [],
        },
      ]),
    });
    const result = await placeFactsInPersona(baseInput);
    expect(result).toEqual([
      {
        decision: "promote_to_new_subsection",
        subsection: "Package manager",
        prose: "Standardised on bun across local and CI.",
        bullets: ["Uses bun", "Pins bun in CI"],
        promoted_loose_ids: [],
      },
    ]);
  });

  it("drops malformed entries but keeps valid ones", async () => {
    mockGenerate.mockResolvedValue({
      text: JSON.stringify([
        { decision: "add_to_loose_facts", bullet: "Uses bun" },
        { decision: "modify_existing", bullet: "nope" }, // invalid variant
        { decision: "skip", reason: "noise" },
      ]),
    });
    const result = await placeFactsInPersona(baseInput);
    expect(result).toHaveLength(2);
    expect(result?.[0].decision).toBe("add_to_loose_facts");
    expect(result?.[1].decision).toBe("skip");
  });

  it("returns null when output is not a JSON array", async () => {
    mockGenerate.mockResolvedValue({
      text: JSON.stringify({ decision: "skip", reason: "x" }),
    });
    const result = await placeFactsInPersona(baseInput);
    expect(result).toBeNull();
  });

  it("returns null when JSON is malformed", async () => {
    mockGenerate.mockResolvedValue({ text: "not json" });
    const result = await placeFactsInPersona(baseInput);
    expect(result).toBeNull();
  });

  it("returns [] when given no facts (no LLM call)", async () => {
    const result = await placeFactsInPersona({
      ...baseInput,
      facts: [],
    });
    expect(result).toEqual([]);
    expect(mockGenerate).not.toHaveBeenCalled();
  });
});
