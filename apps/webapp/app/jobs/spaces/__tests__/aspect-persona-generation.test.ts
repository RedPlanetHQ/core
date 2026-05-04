import { describe, expect, it, vi } from "vitest";

// The module pulls in heavy dependencies (graph provider, batch, model factory)
// that we don't need for the pure-function tests below. Stub them so import
// resolves without spinning up any real infra.
vi.mock("~/services/logger.service", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}));
vi.mock("~/lib/batch.server", () => ({
  createBatch: vi.fn(),
  getBatch: vi.fn(),
}));
vi.mock("~/services/user-context.server", () => ({
  getUserContext: vi.fn(),
}));
vi.mock("@core/providers", () => ({
  ProviderFactory: { getGraphProvider: vi.fn() },
}));
vi.mock("~/services/aspectStore.server", () => ({
  getActiveVoiceAspects: vi.fn(),
  getVoiceAspectsForEpisode: vi.fn(),
}));
vi.mock("~/lib/model.server", () => ({
  createAgent: vi.fn(),
  resolveModelString: vi.fn(),
}));

import {
  applyDelta,
  mergeSectionIntoMarkdown,
  splitByH2Markdown,
} from "../aspect-persona-generation";

describe("applyDelta", () => {
  const baseSection = [
    "- Role: Software Engineer at Acme",
    "- Location: San Francisco",
    "[Confidence: HIGH]",
  ].join("\n");

  it("applies replace ops by default (legacy behaviour)", () => {
    const result = applyDelta(baseSection, {
      add: [],
      replace: [
        {
          old: "Role: Software Engineer at Acme",
          new: "Role: Tech Lead at Acme",
        },
      ],
    });

    expect(result).toContain("- Role: Tech Lead at Acme");
    expect(result).not.toContain("Software Engineer");
  });

  it("inserts add bullets before the [Confidence: …] line", () => {
    const result = applyDelta(baseSection, {
      add: [{ bullet: "Timezone: Asia/Kolkata" }],
      replace: [],
    });

    const lines = result.split("\n");
    const addedIdx = lines.findIndex((l) => l.includes("Timezone: Asia/Kolkata"));
    const confidenceIdx = lines.findIndex((l) => l.startsWith("[Confidence:"));
    expect(addedIdx).toBeGreaterThan(-1);
    expect(addedIdx).toBeLessThan(confidenceIdx);
  });

  // ── Bug repro: incremental update overwrites user-edited bullets ──
  // When the user has manually edited the persona, replace ops would
  // happily target user-edited text and silently overwrite it. With
  // skipReplacements=true the LLM's contradiction-replace is dropped
  // and we only add the new fact, so the user's edit is preserved.
  describe("when skipReplacements is true (user has edited persona)", () => {
    it("drops replace ops, keeping the user-edited bullet intact", () => {
      const userEdited = [
        "- Role: Senior Software Engineer at Acme",
        "[Confidence: HIGH]",
      ].join("\n");

      const result = applyDelta(
        userEdited,
        {
          add: [],
          replace: [
            {
              old: "Role: Senior Software Engineer at Acme",
              new: "Role: Tech Lead at Acme",
            },
          ],
        },
        { skipReplacements: true },
      );

      expect(result).toContain("- Role: Senior Software Engineer at Acme");
      expect(result).not.toContain("Tech Lead");
    });

    it("still applies add ops (new info accumulates instead of replacing)", () => {
      const userEdited = [
        "- Role: Senior Software Engineer at Acme",
        "[Confidence: HIGH]",
      ].join("\n");

      const result = applyDelta(
        userEdited,
        {
          add: [{ bullet: "Role: Tech Lead at Acme" }],
          replace: [
            {
              old: "Role: Senior Software Engineer at Acme",
              new: "Role: Tech Lead at Acme",
            },
          ],
        },
        { skipReplacements: true },
      );

      // Old user line is preserved; new fact is appended as a separate bullet.
      expect(result).toContain("- Role: Senior Software Engineer at Acme");
      expect(result).toContain("- Role: Tech Lead at Acme");
    });
  });
});

// ─── Sanity tests on the section split/merge helpers ────────────────
// Guards that user-added structure between known headings is preserved
// across a round-trip — the second loss path identified during debugging.

describe("splitByH2Markdown / mergeSectionIntoMarkdown", () => {
  it("preserves a user-added custom section verbatim during merge", () => {
    const doc = [
      "# PERSONA",
      "",
      "## IDENTITY",
      "",
      "- Role: Engineer",
      "",
      "## MY NOTES",
      "",
      "- personal note line the user typed",
      "",
      "## PREFERENCES",
      "",
      "- prefers dark mode",
      "",
    ].join("\n");

    const merged = mergeSectionIntoMarkdown(doc, "IDENTITY", "- Role: Tech Lead");

    expect(merged).toContain("## MY NOTES");
    expect(merged).toContain("- personal note line the user typed");
    expect(merged).toContain("- Role: Tech Lead");
  });

  it("returns sections in order with full content recoverable", () => {
    const doc = "## A\n\n- one\n\n## B\n\n- two\n";
    const sections = splitByH2Markdown(doc);
    expect(sections.map((s) => s.heading)).toEqual(["A", "B"]);
    expect(sections.map((s) => s.content).join("")).toBe(doc);
  });
});
