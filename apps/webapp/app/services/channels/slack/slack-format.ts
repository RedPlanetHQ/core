// ---------------------------------------------------------------------------
// Slack mrkdwn formatting utilities
// ---------------------------------------------------------------------------

/**
 * Convert common markdown inline syntax to Slack mrkdwn equivalents.
 */
export function convertInlineMd(text: string): string {
  // Use a placeholder to protect bold markers from being re-processed as italic.
  const BOLD_PLACEHOLDER = "\x00BOLD\x00";
  return text
    .replace(/\*\*(.+?)\*\*/g, `${BOLD_PLACEHOLDER}$1${BOLD_PLACEHOLDER}`) // **bold** → placeholder
    .replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, "_$1_") // *italic* → _italic_
    .replace(/~~(.+?)~~/g, "~$1~") // ~~strike~~ → ~strike~
    .replace(/\[(.+?)\]\((.+?)\)/g, "<$2|$1>") // [text](url) → <url|text>
    .replace(new RegExp(BOLD_PLACEHOLDER, "g"), "*"); // restore bold markers
}

/**
 * Strip all markdown inline syntax from text, leaving plain content.
 */
export function stripInlineMd(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/\*(.+?)\*/g, "$1")
    .replace(/_(.+?)_/g, "$1")
    .replace(/~~(.+?)~~/g, "$1")
    .replace(/\[(.+?)\]\(.+?\)/g, "$1")
    .replace(/`(.+?)`/g, "$1");
}

/**
 * Split text into chunks no larger than `max` characters, preferring paragraph breaks.
 */
export function chunkText(text: string, max: number): string[] {
  if (text.length <= max) return [text];
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > max) {
    const idx = remaining.lastIndexOf("\n\n", max);
    const at = idx > 0 ? idx : max;
    chunks.push(remaining.slice(0, at).trim());
    remaining = remaining.slice(at).trim();
  }
  if (remaining) chunks.push(remaining);
  return chunks;
}

/**
 * Convert markdown list items (`- item` or `* item`) to Slack bullet points (`• item`).
 * Skips content inside fenced code blocks.
 */
export function convertMarkdownListsToSlackBullets(text: string): string {
  const lines = text.split("\n");
  const result: string[] = [];
  let inCodeFence = false;

  for (const line of lines) {
    if (line.match(/^```/)) {
      inCodeFence = !inCodeFence;
      result.push(line);
      continue;
    }
    if (inCodeFence) {
      result.push(line);
      continue;
    }
    // Match list items: optional leading whitespace, then `- ` or `* ` with content.
    // The {3,} horizontal rule check happens upstream; here we rely on requiring a space
    // after the marker so `---` and `***` are not affected.
    const listMatch = line.match(/^(\s*)[-*] (.+)/);
    if (listMatch) {
      result.push(`${listMatch[1]}• ${listMatch[2]}`);
    } else {
      result.push(line);
    }
  }
  return result.join("\n");
}

/**
 * Apply Slack-specific bolding to key elements in a text segment.
 * Skips content inside inline code spans and Slack URL tokens to avoid corruption.
 *
 * Bolded patterns:
 *  - "Action Required" (case-insensitive)
 *  - Standalone priority markers: P1, P2, P3
 *  - Key: Value patterns at the start of a line or after a bullet point (• )
 */
export function boldKeyElements(text: string): string {
  // Split by inline code spans (`...`) and Slack URL tokens (<...>), transform only plain segments.
  const parts: string[] = [];
  const safePattern = /(`[^`\n]+`|<[^>]+>)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = safePattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(applyBoldingToSegment(text.slice(lastIndex, match.index)));
    }
    parts.push(match[0]); // preserve code span / URL token as-is
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) {
    parts.push(applyBoldingToSegment(text.slice(lastIndex)));
  }
  return parts.join("");
}

function applyBoldingToSegment(text: string): string {
  return (
    text
      // "Action Required" — whole phrase, case-insensitive
      .replace(/\b(Action\s+Required)\b/gi, "*$1*")
      // Priority markers P1 / P2 / P3 as standalone words
      .replace(/\b(P[123])\b/g, "*$1*")
      // Key: Value — capital-led word(s) at start of line followed by a colon
      .replace(/^([A-Z][A-Za-z][A-Za-z\s]{0,20}):/gm, "*$1*:")
      // Key: Value — capital-led word(s) right after a Slack bullet (• )
      .replace(/(• )([A-Z][A-Za-z][A-Za-z\s]{0,20}):/g, "$1*$2*:")
  );
}

/**
 * Convert a markdown string into Slack Block Kit blocks.
 *
 * Enhancements over raw markdown pass-through:
 *  - Markdown list items (`-` / `*`) become Slack bullet points (•)
 *  - Key phrases (Action Required, P1/P2/P3, Key: Value) are bolded
 *  - Code blocks are passed through without any transformation
 */
export function markdownToSlackBlocks(markdown: string): unknown[] {
  const blocks: unknown[] = [];
  const lines = markdown.split("\n");
  let sectionLines: string[] = [];
  let codeBlockLines: string[] = [];
  let inCodeFence = false;

  function flushSection() {
    if (sectionLines.length === 0) return;
    const raw = sectionLines.join("\n").trimEnd();
    sectionLines = [];
    if (!raw.trim()) return;
    // Pipeline: convert lists → inline markdown → bold key elements
    const withBullets = convertMarkdownListsToSlackBullets(raw);
    const withMd = convertInlineMd(withBullets);
    const text = boldKeyElements(withMd);
    for (const chunk of chunkText(text, 3000)) {
      blocks.push({ type: "section", text: { type: "mrkdwn", text: chunk } });
    }
  }

  function flushCodeBlock() {
    if (codeBlockLines.length === 0) return;
    const text = codeBlockLines.join("\n");
    codeBlockLines = [];
    if (!text.trim()) return;
    // Code blocks are passed through as-is (no list/bold transformation)
    for (const chunk of chunkText(text, 3000)) {
      blocks.push({ type: "section", text: { type: "mrkdwn", text: chunk } });
    }
  }

  for (const line of lines) {
    // Fenced code block boundary
    if (line.match(/^```/)) {
      if (!inCodeFence) {
        flushSection();
        codeBlockLines.push(line);
        inCodeFence = true;
      } else {
        codeBlockLines.push(line);
        inCodeFence = false;
        flushCodeBlock();
      }
      continue;
    }

    if (inCodeFence) {
      codeBlockLines.push(line);
      continue;
    }

    // H1/H2 → header block
    const h2 = line.match(/^#{1,2}\s+(.+)/);
    if (h2) {
      flushSection();
      blocks.push({
        type: "header",
        text: {
          type: "plain_text",
          text: stripInlineMd(h2[1]).slice(0, 150),
          emoji: true,
        },
      });
      continue;
    }

    // H3–H6 → bold section
    const h3 = line.match(/^#{3,6}\s+(.+)/);
    if (h3) {
      flushSection();
      blocks.push({
        type: "section",
        text: { type: "mrkdwn", text: `*${convertInlineMd(h3[1])}*` },
      });
      continue;
    }

    // Horizontal rule → divider (checked before list detection)
    if (line.match(/^[-*_]{3,}\s*$/)) {
      flushSection();
      blocks.push({ type: "divider" });
      continue;
    }

    // Table separator row — skip
    if (line.match(/^\|[\s:|-]+\|/)) {
      continue;
    }

    // Table data row — flatten to text
    if (line.startsWith("|")) {
      const cells = line
        .split("|")
        .filter((c) => c.trim())
        .map((c) => convertInlineMd(c.trim()));
      sectionLines.push(cells.join("   |   "));
      continue;
    }

    sectionLines.push(line);
  }

  flushSection();
  // Handle unclosed code fence gracefully
  if (codeBlockLines.length > 0) flushCodeBlock();

  // Slack enforces max 50 blocks
  return blocks.slice(0, 50);
}

/**
 * Convert markdown to plain text by stripping all markup.
 */
export function markdownToPlainText(markdown: string): string {
  return markdown
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/\*(.+?)\*/g, "$1")
    .replace(/_(.+?)_/g, "$1")
    .replace(/~~(.+?)~~/g, "$1")
    .replace(/\[(.+?)\]\(.+?\)/g, "$1")
    .replace(/`(.+?)`/g, "$1")
    .replace(/^\|[\s:|-]+\|.*$/gm, "")
    .replace(/^[-*_]{3,}\s*$/gm, "")
    .trim();
}
