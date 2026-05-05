import { describe, expect, it } from "vitest";
import {
  PERSONA_ASPECTS,
  splitByH2Markdown,
  mergeSectionIntoMarkdown,
  headingMatchesCanonical,
  normalizeBullet,
  parseSectionStructure,
  appendBulletToSubsection,
  appendLooseFactBullet,
  appendNewSubsection,
  appendNewSection,
  promoteLooseFactsToSubsection,
  appendTombstone,
  applyPlacementDecision,
} from "../persona-bullet-ops";

import type { PlacementDecision } from "../persona-llm-placement";

describe("PERSONA_ASPECTS", () => {
  it("contains exactly Identity, Preference, Directive in render order", () => {
    expect(PERSONA_ASPECTS).toEqual(["Identity", "Preference", "Directive"]);
  });
});

describe("splitByH2Markdown", () => {
  it("returns empty array for empty input", () => {
    expect(splitByH2Markdown("")).toEqual([]);
    expect(splitByH2Markdown("   \n\n  ")).toEqual([]);
  });

  it("treats a no-heading doc as a single null-heading section", () => {
    const doc = "# PERSONA\n\nLeading text.\n";
    const sections = splitByH2Markdown(doc);
    expect(sections).toHaveLength(1);
    expect(sections[0].heading).toBeNull();
    expect(sections[0].content).toBe(doc);
  });

  it("splits by ## boundaries lossless on round-trip", () => {
    const doc = "## A\n\n- one\n\n## B\n\n- two\n";
    const sections = splitByH2Markdown(doc);
    expect(sections.map((s) => s.heading)).toEqual(["A", "B"]);
    expect(sections.map((s) => s.content).join("")).toBe(doc);
  });
});

describe("headingMatchesCanonical", () => {
  it("matches exact (case-insensitive)", () => {
    expect(headingMatchesCanonical("IDENTITY", "IDENTITY")).toBe(true);
    expect(headingMatchesCanonical("identity", "IDENTITY")).toBe(true);
  });

  it("matches first-token after stripping HTML comments", () => {
    expect(
      headingMatchesCanonical("IDENTITY <!-- user note -->", "IDENTITY"),
    ).toBe(true);
  });

  it("matches whole-word when canonical appears in heading", () => {
    expect(headingMatchesCanonical("My Identity Notes", "IDENTITY")).toBe(true);
  });

  it("rejects unrelated headings", () => {
    expect(headingMatchesCanonical("PREFERENCES", "IDENTITY")).toBe(false);
  });

  it("rejects null headings", () => {
    expect(headingMatchesCanonical(null, "IDENTITY")).toBe(false);
  });
});

describe("mergeSectionIntoMarkdown", () => {
  it("preserves user heading text when section exists", () => {
    const doc = "## My Identity Notes\n\n- Role: Engineer\n";
    const merged = mergeSectionIntoMarkdown(
      doc,
      "IDENTITY",
      "- Role: Tech Lead",
    );
    expect(merged).toContain("## My Identity Notes");
    expect(merged).not.toMatch(/^## IDENTITY$/m);
    expect(merged).toContain("- Role: Tech Lead");
  });

  it("uses canonical heading when creating a new section", () => {
    const doc = "## IDENTITY\n\n- Role: Engineer\n";
    const merged = mergeSectionIntoMarkdown(doc, "PREFERENCES", "- prefers vim");
    expect(merged).toContain("## PREFERENCES");
    expect(merged).toContain("- prefers vim");
  });
});

describe("normalizeBullet", () => {
  it("strips bullet markers and trims whitespace", () => {
    expect(normalizeBullet("- foo")).toBe("foo");
    expect(normalizeBullet("  * bar  ")).toBe("bar");
    expect(normalizeBullet("• baz")).toBe("baz");
    expect(normalizeBullet("plain text")).toBe("plain text");
  });
});

describe("parseSectionStructure", () => {
  it("returns empty structure for missing section", () => {
    const doc = "# PERSONA\n\n## IDENTITY\n\n- Role: Engineer\n";
    const result = parseSectionStructure(doc, "PREFERENCES");
    expect(result.subsections).toEqual([]);
    expect(result.looseFacts).toEqual([]);
  });

  it("extracts loose facts (bullets above any ###)", () => {
    const doc = [
      "## PREFERENCES",
      "",
      "- Prefers Vim-style key bindings.",
      "- Uses ripgrep for codebase search.",
      "",
    ].join("\n");
    const result = parseSectionStructure(doc, "PREFERENCES");
    expect(result.looseFacts).toEqual([
      { id: "L1", text: "Prefers Vim-style key bindings." },
      { id: "L2", text: "Uses ripgrep for codebase search." },
    ]);
    expect(result.subsections).toEqual([]);
  });

  it("extracts subsections with prose first sentence and bullet count", () => {
    const doc = [
      "## PREFERENCES",
      "",
      "### Email writing",
      "",
      "Keeps emails brief, opens with the ask. Signs off with first name.",
      "",
      "- Subject lines are full sentences",
      "- Avoids 'thanks in advance'",
      "",
      "### Code style",
      "",
      "Works in TypeScript with strong style preferences.",
      "",
      "- Tabs over spaces",
      "",
    ].join("\n");
    const result = parseSectionStructure(doc, "PREFERENCES");
    expect(result.subsections).toEqual([
      {
        name: "Email writing",
        proseFirstSentence: "Keeps emails brief, opens with the ask.",
        bulletCount: 2,
      },
      {
        name: "Code style",
        proseFirstSentence:
          "Works in TypeScript with strong style preferences.",
        bulletCount: 1,
      },
    ]);
  });

  it("handles mixed loose facts + subsections", () => {
    const doc = [
      "## PREFERENCES",
      "",
      "- Loose one",
      "",
      "### Email writing",
      "",
      "Single-sentence prose.",
      "",
      "- Bullet A",
      "",
    ].join("\n");
    const result = parseSectionStructure(doc, "PREFERENCES");
    expect(result.looseFacts).toEqual([{ id: "L1", text: "Loose one" }]);
    expect(result.subsections).toHaveLength(1);
    expect(result.subsections[0].name).toBe("Email writing");
  });

  it("ignores tombstone bullets (⚠ Possibly outdated:) when counting", () => {
    const doc = [
      "## PREFERENCES",
      "",
      "### Email writing",
      "",
      "Prose.",
      "",
      "- Real bullet",
      "",
      "- ⚠ Possibly outdated: stale fact",
      "",
      "[Confidence: HIGH]",
    ].join("\n");
    const result = parseSectionStructure(doc, "PREFERENCES");
    expect(result.subsections[0].bulletCount).toBe(1);
  });
});

describe("appendBulletToSubsection", () => {
  const baseDoc = [
    "# PERSONA",
    "",
    "## PREFERENCES",
    "",
    "### Email writing",
    "",
    "Keeps emails brief.",
    "",
    "- Subject lines are full sentences",
    "",
    "### Code style",
    "",
    "Works in TypeScript.",
    "",
    "- Tabs over spaces",
    "",
    "[Confidence: HIGH]",
    "",
  ].join("\n");

  it("appends a bullet at end of the matching subsection bullets zone", () => {
    const out = appendBulletToSubsection(
      baseDoc,
      "PREFERENCES",
      "Email writing",
      "Avoids 'thanks in advance'",
    );
    const lines = out.split("\n");
    const subjectIdx = lines.findIndex((l) =>
      l.includes("Subject lines are full sentences"),
    );
    const newIdx = lines.findIndex((l) =>
      l.includes("Avoids 'thanks in advance'"),
    );
    const codeStyleIdx = lines.findIndex((l) => l.trim() === "### Code style");
    expect(newIdx).toBeGreaterThan(subjectIdx);
    expect(newIdx).toBeLessThan(codeStyleIdx);
    expect(out).toContain("- Avoids 'thanks in advance'");
  });

  it("preserves all existing prose and bullets byte-for-byte", () => {
    const out = appendBulletToSubsection(
      baseDoc,
      "PREFERENCES",
      "Email writing",
      "New bullet",
    );
    expect(out).toContain("### Code style\n\nWorks in TypeScript.\n\n- Tabs over spaces");
    expect(out).toContain("Keeps emails brief.");
    expect(out).toContain("- Subject lines are full sentences");
  });

  it("matches subsection name case-insensitively", () => {
    const out = appendBulletToSubsection(
      baseDoc,
      "PREFERENCES",
      "email writing",
      "Lowercase match",
    );
    expect(out).toContain("- Lowercase match");
  });

  it("returns doc unchanged when subsection not found", () => {
    const out = appendBulletToSubsection(
      baseDoc,
      "PREFERENCES",
      "Nonexistent",
      "Should not appear",
    );
    expect(out).toBe(baseDoc);
  });
});

describe("appendLooseFactBullet", () => {
  it("appends a loose bullet between heading and first ### subsection", () => {
    const doc = [
      "## PREFERENCES",
      "",
      "### Email writing",
      "",
      "Prose.",
      "",
      "- Existing bullet",
      "",
    ].join("\n");
    const out = appendLooseFactBullet(
      doc,
      "PREFERENCES",
      "Prefers Vim bindings",
    );
    const lines = out.split("\n");
    const headingIdx = lines.findIndex((l) => l.trim() === "## PREFERENCES");
    const looseIdx = lines.findIndex((l) => l.includes("Prefers Vim bindings"));
    const subsecIdx = lines.findIndex(
      (l) => l.trim() === "### Email writing",
    );
    expect(looseIdx).toBeGreaterThan(headingIdx);
    expect(looseIdx).toBeLessThan(subsecIdx);
  });

  it("appends after existing loose facts in arrival order", () => {
    const doc = [
      "## PREFERENCES",
      "",
      "- First loose",
      "- Second loose",
      "",
      "### Email writing",
      "",
      "Prose.",
      "",
    ].join("\n");
    const out = appendLooseFactBullet(doc, "PREFERENCES", "Third loose");
    const lines = out.split("\n");
    const firstIdx = lines.findIndex((l) => l.includes("First loose"));
    const secondIdx = lines.findIndex((l) => l.includes("Second loose"));
    const thirdIdx = lines.findIndex((l) => l.includes("Third loose"));
    const subsecIdx = lines.findIndex(
      (l) => l.trim() === "### Email writing",
    );
    expect(firstIdx).toBeLessThan(secondIdx);
    expect(secondIdx).toBeLessThan(thirdIdx);
    expect(thirdIdx).toBeLessThan(subsecIdx);
  });

  it("works when the section has no subsections", () => {
    const doc = "## PREFERENCES\n\n- Existing\n\n[Confidence: HIGH]\n";
    const out = appendLooseFactBullet(doc, "PREFERENCES", "New loose");
    expect(out).toContain("- New loose");
    const lines = out.split("\n");
    const looseIdx = lines.findIndex((l) => l.includes("New loose"));
    const confIdx = lines.findIndex((l) => l.startsWith("[Confidence:"));
    expect(looseIdx).toBeLessThan(confIdx);
  });
});

describe("appendNewSubsection", () => {
  it("appends a new subsection at the end of the subsection list, before tombstones", () => {
    const doc = [
      "## PREFERENCES",
      "",
      "### Email writing",
      "",
      "Email prose.",
      "",
      "- A",
      "",
      "- ⚠ Possibly outdated: stale",
      "",
      "[Confidence: HIGH]",
      "",
    ].join("\n");
    const out = appendNewSubsection(
      doc,
      "PREFERENCES",
      "Code style",
      "Works in TypeScript with strong style preferences.",
      ["Tabs over spaces", "Uses pnpm"],
    );
    const lines = out.split("\n");
    const emailIdx = lines.findIndex((l) => l.trim() === "### Email writing");
    const codeIdx = lines.findIndex((l) => l.trim() === "### Code style");
    const tombstoneIdx = lines.findIndex((l) =>
      l.includes("⚠ Possibly outdated:"),
    );
    const confidenceIdx = lines.findIndex((l) => l.startsWith("[Confidence:"));
    expect(emailIdx).toBeLessThan(codeIdx);
    expect(codeIdx).toBeLessThan(tombstoneIdx);
    expect(tombstoneIdx).toBeLessThan(confidenceIdx);
    expect(out).toContain("Works in TypeScript with strong style preferences.");
    expect(out).toContain("- Tabs over spaces");
    expect(out).toContain("- Uses pnpm");
  });

  it("creates the section if it doesn't exist", () => {
    const doc = "# PERSONA\n\n## IDENTITY\n\n- Role: Engineer\n";
    const out = appendNewSubsection(
      doc,
      "PREFERENCES",
      "Email writing",
      "Keeps emails brief.",
      ["Subject lines as full sentences"],
    );
    expect(out).toContain("## PREFERENCES");
    expect(out).toContain("### Email writing");
    expect(out).toContain("Keeps emails brief.");
    expect(out).toContain("- Subject lines as full sentences");
  });
});

describe("appendNewSection", () => {
  it("appends a canonical ## section heading with empty body at end of doc", () => {
    const doc = "# PERSONA\n\n## IDENTITY\n\n- Role: Engineer\n";
    const out = appendNewSection(doc, "PREFERENCES");
    expect(out.endsWith("## PREFERENCES\n\n")).toBe(true);
    expect(out).toContain("## IDENTITY");
    expect(out).toContain("- Role: Engineer");
  });

  it("returns doc unchanged if the canonical section already exists", () => {
    const doc = "## IDENTITY\n\n- Role\n\n## PREFERENCES\n\n- foo\n";
    const out = appendNewSection(doc, "PREFERENCES");
    expect(out).toBe(doc);
  });
});

describe("promoteLooseFactsToSubsection", () => {
  const doc = [
    "## PREFERENCES",
    "",
    "- Prefers shadcn/ui components",
    "- Uses CSS variables for theme tokens",
    "- Keeps emails brief",
    "",
    "### Email writing",
    "",
    "Email prose.",
    "",
    "- A",
    "",
  ].join("\n");

  it("removes matched loose facts and appends a new subsection block", () => {
    const out = promoteLooseFactsToSubsection(
      doc,
      "PREFERENCES",
      ["Prefers shadcn/ui components", "Uses CSS variables for theme tokens"],
      "Styling",
      "Uses Tailwind plus shadcn/ui with CSS variables for theming.",
      [
        "Always uses Tailwind",
        "Prefers shadcn/ui components",
        "Uses CSS variables for theme tokens",
      ],
    );

    const lines = out.split("\n");
    const stylingIdx = lines.findIndex((l) => l.trim() === "### Styling");
    expect(stylingIdx).toBeGreaterThan(-1);
    const headingIdx = lines.findIndex((l) => l.trim() === "## PREFERENCES");
    const firstSubIdx = lines.findIndex(
      (l, i) => i > headingIdx && l.trim().startsWith("### "),
    );
    const looseZone = lines.slice(headingIdx, firstSubIdx).join("\n");
    expect(looseZone).not.toContain("Prefers shadcn/ui components");
    expect(looseZone).not.toContain("Uses CSS variables for theme tokens");
    expect(looseZone).toContain("Keeps emails brief");

    expect(out).toContain("Uses Tailwind plus shadcn/ui with CSS variables");
    expect(out).toContain("- Always uses Tailwind");
  });

  it("falls back to no-op when no loose-fact text matches", () => {
    const out = promoteLooseFactsToSubsection(
      doc,
      "PREFERENCES",
      ["Bullet that does not exist"],
      "X",
      "Prose.",
      ["bullet"],
    );
    expect(out).toBe(doc);
  });

  it("removes only matched loose bullets — user-edited bullets stay", () => {
    const userEdited = doc.replace(
      "Uses CSS variables for theme tokens",
      "Uses CSS variables PLUS user note",
    );
    const out = promoteLooseFactsToSubsection(
      userEdited,
      "PREFERENCES",
      ["Uses CSS variables for theme tokens"],
      "Styling",
      "Prose.",
      ["bullet"],
    );
    expect(out).toContain("Uses CSS variables PLUS user note");
    expect(out).not.toContain("### Styling");
    expect(out).toBe(userEdited);
  });
});

describe("appendTombstone", () => {
  it("appends `- ⚠ Possibly outdated: <fact>` just before [Confidence: …]", () => {
    const doc = [
      "## PREFERENCES",
      "",
      "### Email writing",
      "",
      "Prose.",
      "",
      "- bullet",
      "",
      "[Confidence: HIGH]",
      "",
    ].join("\n");
    const out = appendTombstone(doc, "PREFERENCES", "Uses pnpm");
    expect(out).toContain("- ⚠ Possibly outdated: Uses pnpm");
    const lines = out.split("\n");
    const tombIdx = lines.findIndex((l) => l.includes("⚠ Possibly outdated:"));
    const confIdx = lines.findIndex((l) => l.startsWith("[Confidence:"));
    expect(tombIdx).toBeLessThan(confIdx);
  });

  it("appends at end of section when no [Confidence:] line", () => {
    const doc = "## PREFERENCES\n\n- bullet\n";
    const out = appendTombstone(doc, "PREFERENCES", "Stale");
    expect(out).toContain("- ⚠ Possibly outdated: Stale");
    expect(out).toContain("- bullet");
  });

  it("multiple tombstones accumulate in order, not deduped", () => {
    const doc = "## PREFERENCES\n\n[Confidence: HIGH]\n";
    const out1 = appendTombstone(doc, "PREFERENCES", "Fact A");
    const out2 = appendTombstone(out1, "PREFERENCES", "Fact A");
    const matches = out2.match(/⚠ Possibly outdated: Fact A/g) ?? [];
    expect(matches.length).toBe(2);
  });

  it("no-ops when section doesn't exist", () => {
    const doc = "## IDENTITY\n\n- Role\n";
    const out = appendTombstone(doc, "PREFERENCES", "Stale");
    expect(out).toBe(doc);
  });
});

describe("user-edited content round-trip safety", () => {
  // Simulates a doc the user has hand-edited: custom subsection, edited
  // prose, edited bullet text, custom user-only section, existing tombstones.
  const userEditedDoc = [
    "# PERSONA",
    "",
    "## IDENTITY",
    "",
    "- Role: Senior Tech Lead at Acme  // user added 'Senior'",
    "",
    "## PREFERENCES",
    "",
    "- Manoj's hand-typed loose fact",
    "",
    "### Email writing",
    "",
    "USER REWROTE THIS PROSE COMPLETELY — totally custom phrasing.",
    "",
    "- user-edited bullet, originally said something else",
    "",
    "### My Personal Subsection",
    "",
    "User created this whole subsection.",
    "",
    "- user bullet",
    "",
    "- ⚠ Possibly outdated: old fact the user hasn't dismissed yet",
    "",
    "[Confidence: HIGH]",
    "",
    "## MY NOTES",
    "",
    "User-only section the system never invents.",
    "",
    "- private note",
    "",
  ].join("\n");

  const userContentFragments = [
    "- Role: Senior Tech Lead at Acme  // user added 'Senior'",
    "- Manoj's hand-typed loose fact",
    "USER REWROTE THIS PROSE COMPLETELY — totally custom phrasing.",
    "- user-edited bullet, originally said something else",
    "### My Personal Subsection",
    "User created this whole subsection.",
    "- user bullet",
    "- ⚠ Possibly outdated: old fact the user hasn't dismissed yet",
    "## MY NOTES",
    "User-only section the system never invents.",
    "- private note",
  ];

  const assertUserContentIntact = (out: string) => {
    for (const frag of userContentFragments) {
      expect(out, `User content lost: "${frag}"`).toContain(frag);
    }
  };

  it("appendBulletToSubsection preserves all user content", () => {
    const out = appendBulletToSubsection(
      userEditedDoc,
      "PREFERENCES",
      "Email writing",
      "newly added bullet",
    );
    assertUserContentIntact(out);
  });

  it("appendLooseFactBullet preserves all user content", () => {
    const out = appendLooseFactBullet(
      userEditedDoc,
      "PREFERENCES",
      "newly added loose fact",
    );
    assertUserContentIntact(out);
  });

  it("appendNewSubsection preserves all user content", () => {
    const out = appendNewSubsection(
      userEditedDoc,
      "PREFERENCES",
      "Code style",
      "Prose.",
      ["new bullet"],
    );
    assertUserContentIntact(out);
  });

  it("promoteLooseFactsToSubsection only deletes matched loose bullets", () => {
    const out = promoteLooseFactsToSubsection(
      userEditedDoc,
      "PREFERENCES",
      ["A bullet that does not exist in the doc"],
      "X",
      "Prose.",
      ["bullet"],
    );
    expect(out).toBe(userEditedDoc);
  });

  it("appendTombstone preserves all user content (and existing tombstone)", () => {
    const out = appendTombstone(
      userEditedDoc,
      "PREFERENCES",
      "newly invalidated fact",
    );
    assertUserContentIntact(out);
    expect(out).toContain(
      "- ⚠ Possibly outdated: old fact the user hasn't dismissed yet",
    );
  });
});

describe("applyPlacementDecision", () => {
  const doc = [
    "## PREFERENCES",
    "",
    "- L1 raw: Loose one",
    "",
    "### Email writing",
    "",
    "Email prose.",
    "",
    "- existing",
    "",
  ].join("\n");

  it("skip → no-op", () => {
    const d: PlacementDecision = { decision: "skip", reason: "noise" };
    expect(applyPlacementDecision(doc, "PREFERENCES", d)).toBe(doc);
  });

  it("append_to_subsection → calls appendBulletToSubsection", () => {
    const d: PlacementDecision = {
      decision: "append_to_subsection",
      subsection: "Email writing",
      bullet: "new bullet",
    };
    const out = applyPlacementDecision(doc, "PREFERENCES", d);
    expect(out).toContain("- new bullet");
  });

  it("add_to_loose_facts → calls appendLooseFactBullet", () => {
    const d: PlacementDecision = {
      decision: "add_to_loose_facts",
      bullet: "new loose",
    };
    const out = applyPlacementDecision(doc, "PREFERENCES", d);
    expect(out).toContain("- new loose");
  });

  it("promote_to_new_subsection → resolves loose IDs and promotes", () => {
    const docWithLooseIds = [
      "## PREFERENCES",
      "",
      "- Loose one",
      "- Loose two",
      "",
      "### Email writing",
      "",
      "Prose.",
      "",
      "- A",
      "",
    ].join("\n");

    const looseIdToText = new Map<string, string>([
      ["L1", "Loose one"],
      ["L2", "Loose two"],
    ]);

    const d: PlacementDecision = {
      decision: "promote_to_new_subsection",
      subsection: "Newsection",
      prose: "Prose for new subsection.",
      bullets: ["new fact bullet", "Loose one", "Loose two"],
      promoted_loose_ids: ["L1", "L2"],
    };
    const out = applyPlacementDecision(
      docWithLooseIds,
      "PREFERENCES",
      d,
      looseIdToText,
    );
    expect(out).toContain("### Newsection");
    expect(out).toContain("Prose for new subsection.");
    const headingIdx = out.split("\n").findIndex(
      (l) => l.trim() === "## PREFERENCES",
    );
    const firstSubIdx = out.split("\n").findIndex(
      (l, i) => i > headingIdx && l.trim().startsWith("### "),
    );
    const looseZone = out
      .split("\n")
      .slice(headingIdx, firstSubIdx)
      .join("\n");
    expect(looseZone).not.toContain("- Loose one");
    expect(looseZone).not.toContain("- Loose two");
  });

  it("promote with unmapped IDs falls back to add_to_loose_facts", () => {
    const d: PlacementDecision = {
      decision: "promote_to_new_subsection",
      subsection: "X",
      prose: "Prose.",
      bullets: ["bullet"],
      promoted_loose_ids: ["L99"],
    };
    const out = applyPlacementDecision(
      doc,
      "PREFERENCES",
      d,
      new Map<string, string>(),
    );
    expect(out).not.toContain("### X");
    expect(out).toContain("- bullet");
  });
});
