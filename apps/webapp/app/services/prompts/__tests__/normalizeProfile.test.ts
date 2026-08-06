import { describe, expect, it } from "vitest";
import { normalizeDocumentPrompt, normalizePrompt } from "../normalize";
import {
  CANONICAL_SECTION_ORDER,
  NORMALIZE_ENTITY_TYPES_TOKEN_BUDGET,
  NORMALIZE_EPISODE_CONTENT_TOKEN_BUDGET,
  NORMALIZE_INGESTION_RULES_TOKEN_BUDGET,
  NORMALIZE_OUTPUT_TOKEN_RESERVE,
  NORMALIZE_PREVIOUS_VERSION_TOKEN_BUDGET,
  NORMALIZE_PROMPT_TOKEN_BUDGET,
  NORMALIZE_RELATED_MEMORIES_TOKEN_BUDGET,
  NORMALIZE_SESSION_CONTEXT_TOKEN_BUDGET,
  SECTION_DROP_PRIORITY,
  assembleSections,
  capNormalizeContext,
  resolveProfile,
  selectSections,
} from "../normalizeProfile";
import { OLLAMA_NUM_CTX } from "../promptBudget";
import { countTokens } from "~/services/search/tokenBudget";
import {
  FIXTURE_ENTITY_TYPES,
  FIXTURE_LONG_CONTENT,
  NORMALIZE_DOCUMENT_FIXTURES,
  NORMALIZE_FIXTURES,
} from "./normalize-fixtures";

/**
 * These tests pin the budget arithmetic against real measured token counts.
 * The equivalent arithmetic for the rerank prompt was wrong in the dangerous
 * direction on its first draft (predicted ~3050, real figure 3779), so the
 * worst cases are measured here rather than trusted.
 */

function promptTokens(messages: ReturnType<typeof normalizePrompt>): number {
  return countTokens(messages.map((m) => m.content as string).join(""));
}

describe("normalize budgets fit the pinned Ollama window", () => {
  it("reserves output inside the VRAM-pinned context window", () => {
    expect(OLLAMA_NUM_CTX).toBe(4096);
    expect(NORMALIZE_PROMPT_TOKEN_BUDGET + NORMALIZE_OUTPUT_TOKEN_RESERVE).toBeLessThan(
      OLLAMA_NUM_CTX,
    );
  });

  it("document diff mode is the binding worst case and fits", () => {
    const messages = normalizeDocumentPrompt(
      NORMALIZE_DOCUMENT_FIXTURES["document-oversized"],
      "ollama",
    );
    const total = promptTokens(messages);

    expect(total).toBeLessThanOrEqual(NORMALIZE_PROMPT_TOKEN_BUDGET);
    expect(total + NORMALIZE_OUTPUT_TOKEN_RESERVE).toBeLessThan(OLLAMA_NUM_CTX);
  });

  it("document plain mode fits with room to spare", () => {
    const total = promptTokens(
      normalizeDocumentPrompt(NORMALIZE_DOCUMENT_FIXTURES["document-plain"], "ollama"),
    );
    expect(total).toBeLessThanOrEqual(NORMALIZE_PROMPT_TOKEN_BUDGET);
  });

  it("conversation prompt fits once sections are dropped", () => {
    const total = promptTokens(
      normalizePrompt(NORMALIZE_FIXTURES["conversation-oversized"], "ollama"),
    );
    expect(total).toBeLessThanOrEqual(NORMALIZE_PROMPT_TOKEN_BUDGET);
  });
});

describe("capNormalizeContext", () => {
  it("is a no-op on the hosted profile", () => {
    const context = NORMALIZE_FIXTURES["conversation-oversized"];
    expect(capNormalizeContext(context, "hosted")).toBe(context);
  });

  it("caps every variable-length injection on the ollama profile", () => {
    const capped = capNormalizeContext(
      NORMALIZE_DOCUMENT_FIXTURES["document-oversized"],
      "ollama",
    );

    expect(countTokens(capped.episodeContent)).toBeLessThanOrEqual(
      NORMALIZE_EPISODE_CONTENT_TOKEN_BUDGET,
    );
    expect(countTokens(capped.sessionContext)).toBeLessThanOrEqual(
      NORMALIZE_SESSION_CONTEXT_TOKEN_BUDGET,
    );
    expect(countTokens(capped.relatedMemories)).toBeLessThanOrEqual(
      NORMALIZE_RELATED_MEMORIES_TOKEN_BUDGET,
    );
    expect(countTokens(capped.previousVersionContent)).toBeLessThanOrEqual(
      NORMALIZE_PREVIOUS_VERSION_TOKEN_BUDGET,
    );
    expect(countTokens(capped.ingestionRules)).toBeLessThanOrEqual(
      NORMALIZE_INGESTION_RULES_TOKEN_BUDGET,
    );
  });

  it("asserts rather than truncates the real entity-type list", () => {
    // Guards the live EntityTypes enum: growing it past the budget must fail
    // loudly here rather than silently shrinking the taxonomy in production.
    expect(countTokens(FIXTURE_ENTITY_TYPES)).toBeLessThanOrEqual(
      NORMALIZE_ENTITY_TYPES_TOKEN_BUDGET,
    );
    expect(() =>
      capNormalizeContext({ entityTypes: FIXTURE_LONG_CONTENT }, "ollama"),
    ).toThrow(/PromptBudget/);
  });

  it("leaves absent values absent so downstream fallbacks still fire", () => {
    const capped = capNormalizeContext(
      { episodeContent: "x", sessionContext: undefined },
      "ollama",
    );
    expect(capped.sessionContext).toBeUndefined();
    expect("previousVersionContent" in capped).toBe(false);
  });
});

describe("section selection", () => {
  const sections = Object.fromEntries(
    CANONICAL_SECTION_ORDER.map((id) => [id, `<${id}>${FIXTURE_LONG_CONTENT}</${id}>`]),
  ) as Record<(typeof CANONICAL_SECTION_ORDER)[number], string>;

  it("keeps every section on the hosted profile regardless of size", () => {
    expect(selectSections(sections, "hosted", { fixedTokens: 100_000 })).toEqual(
      CANONICAL_SECTION_ORDER,
    );
  });

  it("never drops the undroppable sections", () => {
    const selected = selectSections(sections, "ollama", {
      fixedTokens: 0,
      budget: 100_000,
    });
    for (const id of ["preamble", "entity_types", "ingestion_rules", "output_format"] as const) {
      expect(selected).toContain(id);
    }
  });

  it("drops enrichment_examples first", () => {
    const small = Object.fromEntries(
      CANONICAL_SECTION_ORDER.map((id) => [id, `<${id}>body</${id}>`]),
    ) as typeof sections;

    // A budget one token under the full composition forces exactly one drop.
    const full = countTokens(assembleSections(small, [...CANONICAL_SECTION_ORDER]));
    const selected = selectSections(small, "ollama", {
      fixedTokens: 0,
      budget: full - 1,
    });

    expect(selected).not.toContain(SECTION_DROP_PRIORITY[0]);
    expect(selected).toContain(SECTION_DROP_PRIORITY[1]);
  });

  it("stops dropping as soon as it fits", () => {
    const small = Object.fromEntries(
      CANONICAL_SECTION_ORDER.map((id) => [id, `<${id}>body</${id}>`]),
    ) as typeof sections;

    const full = countTokens(assembleSections(small, [...CANONICAL_SECTION_ORDER]));
    const selected = selectSections(small, "ollama", { fixedTokens: 0, budget: full });
    expect(selected).toEqual(CANONICAL_SECTION_ORDER);
  });

  it("throws rather than silently shipping an over-budget prompt", () => {
    expect(() =>
      selectSections(sections, "ollama", { fixedTokens: 0, budget: 10 }),
    ).toThrow(/PromptBudget/);
  });

  it("accounts for fixedTokens when asserting, not just the sections", () => {
    const small = Object.fromEntries(
      CANONICAL_SECTION_ORDER.map((id) => [id, `<${id}>body</${id}>`]),
    ) as typeof sections;

    // Sections alone fit the budget, but the user prompt pushes it over. The
    // assertion must still fire — this is the bug that made the fail-loud path
    // silently pass.
    const undroppableOnly = countTokens(
      assembleSections(small, ["preamble", "entity_types", "ingestion_rules", "output_format"]),
    );
    expect(() =>
      selectSections(small, "ollama", {
        fixedTokens: 500,
        budget: undroppableOnly + 400,
      }),
    ).toThrow(/PromptBudget/);
  });
});

describe("resolveProfile", () => {
  it("maps ollama to the bounded profile and everything else to hosted", () => {
    expect(resolveProfile("ollama")).toBe("ollama");
    expect(resolveProfile("openai")).toBe("hosted");
    expect(resolveProfile("azure")).toBe("hosted");
  });
});
