import { describe, it, expect } from "vitest";
import {
  convertInlineMd,
  convertMarkdownListsToSlackBullets,
  boldKeyElements,
  markdownToSlackBlocks,
  markdownToPlainText,
  chunkText,
} from "./slack-format";

// ---------------------------------------------------------------------------
// convertMarkdownListsToSlackBullets
// ---------------------------------------------------------------------------
describe("convertMarkdownListsToSlackBullets", () => {
  it("converts hyphen list items to Slack bullets", () => {
    const result = convertMarkdownListsToSlackBullets("- Item one\n- Item two");
    expect(result).toBe("• Item one\n• Item two");
  });

  it("converts asterisk list items to Slack bullets", () => {
    const result = convertMarkdownListsToSlackBullets("* Item one\n* Item two");
    expect(result).toBe("• Item one\n• Item two");
  });

  it("preserves fenced code block contents unchanged", () => {
    const input = "```\n- not a bullet\n* also not\n```";
    expect(convertMarkdownListsToSlackBullets(input)).toBe(input);
  });

  it("does not convert horizontal rules (--- / ***)", () => {
    expect(convertMarkdownListsToSlackBullets("---")).toBe("---");
    expect(convertMarkdownListsToSlackBullets("***")).toBe("***");
    expect(convertMarkdownListsToSlackBullets("___")).toBe("___");
  });

  it("preserves non-list lines unchanged", () => {
    expect(convertMarkdownListsToSlackBullets("Hello world")).toBe("Hello world");
  });

  it("handles indented list items", () => {
    expect(convertMarkdownListsToSlackBullets("  - Indented item")).toBe(
      "  • Indented item"
    );
  });

  it("converts only list lines, leaving surrounding text intact", () => {
    const input = "Intro text\n- Item\nTrailing text";
    const result = convertMarkdownListsToSlackBullets(input);
    expect(result).toBe("Intro text\n• Item\nTrailing text");
  });

  it("mixed list items in same block", () => {
    const result = convertMarkdownListsToSlackBullets("- First\n* Second\n- Third");
    expect(result).toBe("• First\n• Second\n• Third");
  });
});

// ---------------------------------------------------------------------------
// boldKeyElements
// ---------------------------------------------------------------------------
describe("boldKeyElements", () => {
  it('bolds "Action Required"', () => {
    expect(boldKeyElements("Action Required: please fix")).toContain(
      "*Action Required*"
    );
  });

  it('bolds "action required" (case-insensitive)', () => {
    expect(boldKeyElements("action required to proceed")).toContain(
      "*action required*"
    );
  });

  it("bolds P1 as a standalone word", () => {
    expect(boldKeyElements("This is P1 priority")).toBe("This is *P1* priority");
  });

  it("bolds P2 as a standalone word", () => {
    expect(boldKeyElements("P2 issue found")).toBe("*P2* issue found");
  });

  it("bolds P3 as a standalone word", () => {
    expect(boldKeyElements("Severity: P3")).toContain("*P3*");
  });

  it("does not bold P1 inside inline code spans", () => {
    expect(boldKeyElements("`P1 value`")).toBe("`P1 value`");
  });

  it("does not bold Action Required inside Slack URL tokens", () => {
    const url = "<https://example.com|Action Required>";
    expect(boldKeyElements(url)).toBe(url);
  });

  it("does not modify arbitrary Slack tokens", () => {
    const token = "<https://example.com|click here>";
    expect(boldKeyElements(token)).toBe(token);
  });

  it("bolds a Key: Value pattern at the start of a line", () => {
    const result = boldKeyElements("Status: active");
    expect(result).toContain("*Status*:");
  });

  it("bolds a Key: Value pattern after a Slack bullet", () => {
    const result = boldKeyElements("• Priority: high");
    expect(result).toContain("*Priority*:");
  });

  it("does not double-bold already-bolded text", () => {
    const input = "*Status*: active";
    expect(boldKeyElements(input)).toBe("*Status*: active");
  });

  it("preserves text with no special elements unchanged", () => {
    expect(boldKeyElements("just some regular text")).toBe(
      "just some regular text"
    );
  });
});

// ---------------------------------------------------------------------------
// markdownToSlackBlocks — list conversion
// ---------------------------------------------------------------------------
describe("markdownToSlackBlocks — list conversion", () => {
  it("converts markdown list items to Slack bullets in section blocks", () => {
    const blocks = markdownToSlackBlocks("- Item one\n- Item two") as any[];
    expect(blocks).toHaveLength(1);
    expect(blocks[0].text.text).toContain("• Item one");
    expect(blocks[0].text.text).toContain("• Item two");
  });

  it("does not convert list syntax inside fenced code blocks", () => {
    const input = "```\n- not a bullet\n```";
    const blocks = markdownToSlackBlocks(input) as any[];
    const text = blocks[0].text.text;
    expect(text).toContain("- not a bullet");
    expect(text).not.toContain("• not a bullet");
  });

  it("handles mixed content: text, list, then text", () => {
    const input = "Intro\n- Item\nOutro";
    const blocks = markdownToSlackBlocks(input) as any[];
    const text = blocks[0].text.text;
    expect(text).toContain("• Item");
    expect(text).toContain("Intro");
    expect(text).toContain("Outro");
  });
});

// ---------------------------------------------------------------------------
// markdownToSlackBlocks — bolding
// ---------------------------------------------------------------------------
describe("markdownToSlackBlocks — bolding", () => {
  it("bolds Action Required in section content", () => {
    const blocks = markdownToSlackBlocks("Action Required: fix this") as any[];
    expect(blocks[0].text.text).toContain("*Action Required*");
  });

  it("does not bold Action Required inside fenced code blocks", () => {
    const blocks = markdownToSlackBlocks(
      "```\nAction Required: fix\n```"
    ) as any[];
    const text = blocks[0].text.text;
    expect(text).not.toMatch(/\*Action Required\*/);
  });

  it("bolds P1/P2/P3 in section content", () => {
    const blocks = markdownToSlackBlocks("Ticket is P2 priority") as any[];
    expect(blocks[0].text.text).toContain("*P2*");
  });

  it("does not bold P1 inside a code block", () => {
    const blocks = markdownToSlackBlocks("```\nP1 config\n```") as any[];
    expect(blocks[0].text.text).not.toContain("*P1*");
  });
});

// ---------------------------------------------------------------------------
// markdownToSlackBlocks — existing behaviour preserved
// ---------------------------------------------------------------------------
describe("markdownToSlackBlocks — existing formatting preserved", () => {
  it("creates a header block for H1", () => {
    const blocks = markdownToSlackBlocks("# My Title") as any[];
    expect(blocks[0]).toMatchObject({ type: "header" });
    expect(blocks[0].text.text).toBe("My Title");
  });

  it("creates a header block for H2", () => {
    const blocks = markdownToSlackBlocks("## Sub Title") as any[];
    expect(blocks[0]).toMatchObject({ type: "header" });
  });

  it("creates a bold section for H3", () => {
    const blocks = markdownToSlackBlocks("### Section") as any[];
    expect(blocks[0].text.text).toBe("*Section*");
  });

  it("creates a divider for horizontal rule", () => {
    const blocks = markdownToSlackBlocks("---") as any[];
    expect(blocks[0]).toMatchObject({ type: "divider" });
  });

  it("converts **bold** to Slack *bold*", () => {
    const blocks = markdownToSlackBlocks("**important** word") as any[];
    expect(blocks[0].text.text).toContain("*important*");
  });

  it("converts [text](url) to Slack <url|text>", () => {
    const blocks = markdownToSlackBlocks(
      "[click here](https://example.com)"
    ) as any[];
    expect(blocks[0].text.text).toContain("<https://example.com|click here>");
  });

  it("caps output at 50 blocks", () => {
    const md = Array.from({ length: 60 }, (_, i) => `# Heading ${i}`).join("\n");
    const blocks = markdownToSlackBlocks(md);
    expect(blocks.length).toBeLessThanOrEqual(50);
  });
});

// ---------------------------------------------------------------------------
// convertInlineMd
// ---------------------------------------------------------------------------
describe("convertInlineMd", () => {
  it("converts **bold** to *bold*", () => {
    expect(convertInlineMd("**hello**")).toBe("*hello*");
  });

  it("converts [text](url) to <url|text>", () => {
    expect(convertInlineMd("[click](https://x.com)")).toBe(
      "<https://x.com|click>"
    );
  });

  it("converts ~~strike~~ to ~strike~", () => {
    expect(convertInlineMd("~~del~~")).toBe("~del~");
  });
});

// ---------------------------------------------------------------------------
// markdownToPlainText
// ---------------------------------------------------------------------------
describe("markdownToPlainText", () => {
  it("strips heading markers", () => {
    expect(markdownToPlainText("# Title")).toBe("Title");
  });

  it("strips bold markers", () => {
    expect(markdownToPlainText("**bold**")).toBe("bold");
  });

  it("strips link syntax, keeping text", () => {
    expect(markdownToPlainText("[click](https://x.com)")).toBe("click");
  });
});

// ---------------------------------------------------------------------------
// chunkText
// ---------------------------------------------------------------------------
describe("chunkText", () => {
  it("returns single element for short text", () => {
    expect(chunkText("hello", 100)).toEqual(["hello"]);
  });

  it("splits text longer than max", () => {
    const long = "a".repeat(3001);
    const chunks = chunkText(long, 3000);
    expect(chunks.length).toBeGreaterThan(1);
  });
});
