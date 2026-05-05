import type { StatementAspect } from "@core/types";
import type { PlacementDecision } from "./persona-llm-placement";

/**
 * Single source of truth for the aspects that get rendered into the persona
 * document. Add a new aspect here and the trigger query, the per-add
 * placement, the voice-merge filter, and the section render order all pick
 * it up automatically — no other edits required.
 *
 * The order here is also the rendering order in the final document.
 */
export const PERSONA_ASPECTS: StatementAspect[] = [
  "Identity",
  "Preference",
  "Directive",
];

// ─── Markdown section split / merge primitives ──────────────────────

export interface MarkdownSection {
  heading: string | null; // null = content before the first ## heading
  content: string; // raw markdown for this section (including the ## line)
}

/**
 * Split a markdown document into sections by `## ` boundaries.
 * The first section (before any ##) has heading = null.
 * Preserves every byte — join all .content to reconstruct the original.
 */
export function splitByH2Markdown(doc: string): MarkdownSection[] {
  if (!doc.trim()) return [];

  const sections: MarkdownSection[] = [];
  const h2Regex = /^## /gm;
  const positions: number[] = [];
  let m: RegExpExecArray | null;

  while ((m = h2Regex.exec(doc)) !== null) {
    positions.push(m.index);
  }

  if (positions.length === 0) {
    return [{ heading: null, content: doc }];
  }

  if (positions[0] > 0) {
    sections.push({ heading: null, content: doc.slice(0, positions[0]) });
  }

  for (let i = 0; i < positions.length; i++) {
    const start = positions[i];
    const end = i + 1 < positions.length ? positions[i + 1] : doc.length;
    const raw = doc.slice(start, end);
    const firstNewline = raw.indexOf("\n");
    const headingLine =
      firstNewline >= 0 ? raw.slice(3, firstNewline) : raw.slice(3);
    sections.push({ heading: headingLine.trim(), content: raw });
  }

  return sections;
}

/**
 * Decide whether `heading` is a user-customised version of canonical
 * `sectionName`. Accepts exact (case-insensitive, after HTML-comment strip),
 * first-token match, or canonical name appearing as a whole word.
 */
export function headingMatchesCanonical(
  heading: string | null,
  sectionName: string,
): boolean {
  if (!heading) return false;
  const name = sectionName.trim().toUpperCase();
  const stripped = heading
    .replace(/<!--[\s\S]*?-->/g, "")
    .trim()
    .toUpperCase();
  if (stripped === name) return true;
  const firstToken = stripped.split(/\s+/)[0];
  if (firstToken === name) return true;
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const wordRe = new RegExp(`\\b${escaped}\\b`);
  return wordRe.test(stripped);
}

/**
 * Find a section by canonical name, replace its body, return the doc.
 * Preserves the user's existing heading text verbatim when matched;
 * uses the canonical heading only when creating a new section.
 */
export function mergeSectionIntoMarkdown(
  doc: string,
  sectionName: string,
  newBody: string,
): string {
  const sections = splitByH2Markdown(doc);

  const targetIndex = sections.findIndex((s) =>
    headingMatchesCanonical(s.heading, sectionName),
  );

  if (targetIndex >= 0) {
    const existing = sections[targetIndex];
    const existingHeading = existing.heading ?? sectionName;
    sections[targetIndex] = {
      heading: existingHeading,
      content: `## ${existingHeading}\n\n${newBody}\n\n`,
    };
  } else {
    sections.push({
      heading: sectionName,
      content: `## ${sectionName}\n\n${newBody}\n\n`,
    });
  }

  return sections.map((s) => s.content).join("");
}

/**
 * Strip leading bullet marker (`-`, `*`, `•`) and surrounding whitespace.
 */
export function normalizeBullet(text: string): string {
  return text.replace(/^[\s]*[-*•]\s*/, "").trim();
}

// ─── Section structure parsing (read-side summarisation) ──────────────────────

export interface SubsectionSummary {
  name: string;
  proseFirstSentence: string;
  bulletCount: number;
}

export interface LooseFact {
  id: string; // L1, L2, ...
  text: string; // normalised bullet text (without leading "- ")
}

export interface SectionStructure {
  subsections: SubsectionSummary[];
  looseFacts: LooseFact[];
}

const TOMBSTONE_PREFIX = "⚠ Possibly outdated:";

function isTombstoneBullet(normalised: string): boolean {
  return normalised.startsWith(TOMBSTONE_PREFIX);
}

function isBulletLine(trimmed: string): boolean {
  return (
    trimmed.startsWith("- ") ||
    trimmed.startsWith("* ") ||
    trimmed.startsWith("• ")
  );
}

function firstSentenceOf(prose: string): string {
  const trimmed = prose.trim();
  if (!trimmed) return "";
  // Split on first ".", "!", or "?" followed by whitespace or end-of-string.
  const match = trimmed.match(/^[^.!?]*[.!?]/);
  return match ? match[0].trim() : trimmed;
}

/**
 * Read-side parser used to summarise a section's structure for the LLM
 * placement prompt. Never modifies the doc; returns subsection anchors
 * (name + first sentence + bullet count) and loose-fact bullets with
 * auto-generated stable IDs (`L1`, `L2`, ...) for the placement output
 * to reference.
 */
export function parseSectionStructure(
  doc: string,
  sectionTitle: string,
): SectionStructure {
  const sections = splitByH2Markdown(doc);
  const target = sections.find((s) =>
    headingMatchesCanonical(s.heading, sectionTitle),
  );
  if (!target) return { subsections: [], looseFacts: [] };

  // Drop the heading line; iterate the body.
  const firstNewline = target.content.indexOf("\n");
  const body = firstNewline >= 0 ? target.content.slice(firstNewline + 1) : "";
  const lines = body.split("\n");

  const looseFacts: LooseFact[] = [];
  const subsections: SubsectionSummary[] = [];

  let inSubsection = false;
  let currentName: string | null = null;
  let currentProse = "";
  let currentBulletCount = 0;
  let proseClosed = false; // once we hit the first bullet line in a subsection, prose is closed

  const flushSubsection = () => {
    if (currentName === null) return;
    subsections.push({
      name: currentName,
      proseFirstSentence: firstSentenceOf(currentProse),
      bulletCount: currentBulletCount,
    });
    currentName = null;
    currentProse = "";
    currentBulletCount = 0;
    proseClosed = false;
  };

  for (const line of lines) {
    const trimmed = line.trim();

    if (trimmed.startsWith("### ")) {
      flushSubsection();
      inSubsection = true;
      currentName = trimmed.slice(4).trim();
      continue;
    }

    if (trimmed.startsWith("## ")) {
      // Defensive: shouldn't happen because we sliced one section, but stop if it does.
      break;
    }

    if (trimmed.startsWith("[Confidence:")) continue;

    if (!inSubsection) {
      // Loose-facts zone (before any ###).
      if (isBulletLine(trimmed)) {
        const norm = normalizeBullet(trimmed);
        if (norm && !isTombstoneBullet(norm)) {
          looseFacts.push({ id: `L${looseFacts.length + 1}`, text: norm });
        }
      }
      continue;
    }

    // Inside a subsection.
    if (isBulletLine(trimmed)) {
      proseClosed = true;
      const norm = normalizeBullet(trimmed);
      if (norm && !isTombstoneBullet(norm)) {
        currentBulletCount++;
      }
      continue;
    }

    if (!proseClosed && trimmed) {
      // Accumulate prose.
      currentProse = currentProse ? `${currentProse} ${trimmed}` : trimmed;
    }
  }

  flushSubsection();

  return { subsections, looseFacts };
}

// ─── Write-side bullet ops ──────────────────────────────────────────────

function getSectionBody(sectionContent: string): string {
  const firstNewline = sectionContent.indexOf("\n");
  if (firstNewline < 0) return "";
  return sectionContent.slice(firstNewline + 1);
}

function rewriteSectionBody(
  doc: string,
  sectionTitle: string,
  rewriteBody: (body: string) => string,
): string {
  const sections = splitByH2Markdown(doc);
  const idx = sections.findIndex((s) =>
    headingMatchesCanonical(s.heading, sectionTitle),
  );
  if (idx < 0) return doc;
  const existing = sections[idx];

  const headingLine = existing.content.slice(0, existing.content.indexOf("\n"));
  const body = getSectionBody(existing.content);
  const newBody = rewriteBody(body);
  if (newBody === body) return doc;
  sections[idx] = {
    heading: existing.heading,
    content: `${headingLine}\n${newBody}`,
  };
  return sections.map((s) => s.content).join("");
}

/**
 * Append a bullet at the end of the named subsection's bullets zone.
 * No-op if the section doesn't exist or the subsection isn't found.
 * Preserves all surrounding content byte-for-byte.
 */
export function appendBulletToSubsection(
  doc: string,
  sectionTitle: string,
  subsectionName: string,
  bullet: string,
): string {
  return rewriteSectionBody(doc, sectionTitle, (body) => {
    const lines = body.split("\n");
    const wantedName = subsectionName.trim().toLowerCase();
    let subStart = -1;
    let subEnd = lines.length;

    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i].trim();
      if (trimmed.startsWith("### ")) {
        const name = trimmed.slice(4).trim().toLowerCase();
        if (subStart === -1 && name === wantedName) {
          subStart = i;
        } else if (subStart !== -1) {
          subEnd = i;
          break;
        }
      }
    }
    if (subStart === -1) return body;

    // Find the last non-blank, non-tombstone bullet line within [subStart+1, subEnd).
    // Insert the new bullet after it. If no bullets exist yet, insert after
    // the prose paragraph (i.e., after the first non-blank line following
    // the ### heading), with a blank line separator.
    let lastBulletIdx = -1;
    for (let i = subStart + 1; i < subEnd; i++) {
      const trimmed = lines[i].trim();
      if (!isBulletLine(trimmed)) continue;
      const norm = normalizeBullet(trimmed);
      if (isTombstoneBullet(norm)) continue;
      lastBulletIdx = i;
    }

    const newLine = `- ${bullet}`;
    if (lastBulletIdx !== -1) {
      lines.splice(lastBulletIdx + 1, 0, newLine);
    } else {
      // Append at end of subsection (just before the next ### or section
      // boundary). Trim trailing blanks from the subsection's tail.
      let insertAt = subEnd;
      while (insertAt > subStart + 1 && lines[insertAt - 1].trim() === "") {
        insertAt--;
      }
      lines.splice(insertAt, 0, "", newLine);
    }
    return lines.join("\n");
  });
}

/**
 * Append a loose-fact bullet at the end of the loose-facts zone — just
 * after the last existing loose bullet (or, if none, right after the section
 * heading), and always before the first `### subsection` if one exists.
 */
export function appendLooseFactBullet(
  doc: string,
  sectionTitle: string,
  bullet: string,
): string {
  return rewriteSectionBody(doc, sectionTitle, (body) => {
    const lines = body.split("\n");
    let firstSubsectionIdx = lines.findIndex((l) => l.trim().startsWith("### "));
    if (firstSubsectionIdx === -1) {
      // No subsection — fall through and find first tombstone or [Confidence:]
      firstSubsectionIdx = lines.findIndex((l) => {
        const t = l.trim();
        if (t.startsWith("[Confidence:")) return true;
        if (isBulletLine(t) && isTombstoneBullet(normalizeBullet(t))) return true;
        return false;
      });
      if (firstSubsectionIdx === -1) firstSubsectionIdx = lines.length;
    }

    // Find the last loose bullet (non-tombstone) before firstSubsectionIdx.
    let lastLooseIdx = -1;
    for (let i = 0; i < firstSubsectionIdx; i++) {
      const trimmed = lines[i].trim();
      if (!isBulletLine(trimmed)) continue;
      const norm = normalizeBullet(trimmed);
      if (isTombstoneBullet(norm)) continue;
      lastLooseIdx = i;
    }

    const newLine = `- ${bullet}`;
    if (lastLooseIdx !== -1) {
      lines.splice(lastLooseIdx + 1, 0, newLine);
    } else {
      // No existing loose bullets — insert just after the leading blank
      // line(s) at the top of the body, before any subsection / tombstone.
      let insertAt = 0;
      while (insertAt < firstSubsectionIdx && lines[insertAt].trim() === "") {
        insertAt++;
      }
      // Ensure exactly one blank line separator before the new bullet.
      if (insertAt > 0 && lines[insertAt - 1].trim() !== "") {
        lines.splice(insertAt, 0, "", newLine, "");
      } else {
        lines.splice(insertAt, 0, newLine, "");
      }
    }
    return lines.join("\n");
  });
}

// ─── New subsection operations ──────────────────────────────────────────────

function buildSubsectionBlock(
  name: string,
  prose: string,
  bullets: string[],
): string {
  const proseTrim = prose.trim();
  const bulletLines = bullets.map((b) => `- ${b}`).join("\n");
  return `### ${name}\n\n${proseTrim}\n\n${bulletLines}\n`;
}

/**
 * Append a new ### subsection (with prose + initial bullets) at the end of
 * the section's subsection list — just before the tombstone block (and the
 * [Confidence: …] line, if present). Creates the section if missing.
 */
export function appendNewSubsection(
  doc: string,
  sectionTitle: string,
  subsectionName: string,
  prose: string,
  bullets: string[],
): string {
  const sections = splitByH2Markdown(doc);
  const idx = sections.findIndex((s) =>
    headingMatchesCanonical(s.heading, sectionTitle),
  );
  if (idx < 0) {
    const body = buildSubsectionBlock(subsectionName, prose, bullets);
    return mergeSectionIntoMarkdown(doc, sectionTitle, body);
  }

  return rewriteSectionBody(doc, sectionTitle, (body) => {
    const lines = body.split("\n");
    let endOfSubsections = lines.length;
    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i].trim();
      if (trimmed.startsWith("[Confidence:")) {
        endOfSubsections = i;
        break;
      }
      if (isBulletLine(trimmed) && isTombstoneBullet(normalizeBullet(trimmed))) {
        endOfSubsections = i;
        break;
      }
    }
    while (
      endOfSubsections > 0 &&
      lines[endOfSubsections - 1].trim() === ""
    ) {
      endOfSubsections--;
    }
    const block = buildSubsectionBlock(subsectionName, prose, bullets);
    const before = lines.slice(0, endOfSubsections).join("\n");
    const after = lines.slice(endOfSubsections).join("\n");
    const sep = before.endsWith("\n") || before === "" ? "\n" : "\n\n";
    const tail = after.startsWith("\n") || after === "" ? "" : "\n";
    return `${before}${sep}${block}${tail}${after}`;
  });
}

/**
 * Append a canonical ## SECTION heading with an empty content area at the
 * end of the doc. No-op if the section already exists.
 */
export function appendNewSection(doc: string, sectionTitle: string): string {
  const sections = splitByH2Markdown(doc);
  const exists = sections.some((s) =>
    headingMatchesCanonical(s.heading, sectionTitle),
  );
  if (exists) return doc;
  const sep = doc.length === 0 || doc.endsWith("\n") ? "" : "\n";
  return `${doc}${sep}\n## ${sectionTitle}\n\n`;
}

/**
 * Atomic structural promotion: remove the named loose-fact bullets (by
 * exact normalised text) and append a new ### subsection containing prose
 * plus initial bullets. The deletion is bounded — bullets that don't
 * exact-match `looseTextsToRemove` are kept (user edits are protected).
 *
 * If no loose bullets matched, the operation is a no-op (returns doc
 * unchanged) — we never create a "ghost" subsection from scratch via this
 * path. Use `appendNewSubsection` for that.
 */
export function promoteLooseFactsToSubsection(
  doc: string,
  sectionTitle: string,
  looseTextsToRemove: string[],
  subsectionName: string,
  prose: string,
  bullets: string[],
): string {
  const sections = splitByH2Markdown(doc);
  const idx = sections.findIndex((s) =>
    headingMatchesCanonical(s.heading, sectionTitle),
  );
  if (idx < 0) return doc;

  const wantedSet = new Set(looseTextsToRemove.map((t) => t.trim()));

  // First pass: count matches in the loose-facts zone.
  const headingLine = sections[idx].content.slice(
    0,
    sections[idx].content.indexOf("\n"),
  );
  const body = getSectionBody(sections[idx].content);
  const lines = body.split("\n");
  const firstSubIdx = lines.findIndex((l) => l.trim().startsWith("### "));
  const looseZoneEnd = firstSubIdx === -1 ? lines.length : firstSubIdx;

  let matched = 0;
  for (let i = 0; i < looseZoneEnd; i++) {
    const trimmed = lines[i].trim();
    if (!isBulletLine(trimmed)) continue;
    const norm = normalizeBullet(trimmed);
    if (isTombstoneBullet(norm)) continue;
    if (wantedSet.has(norm)) matched++;
  }
  if (matched === 0) return doc;

  // Second pass: build new lines without matched loose bullets.
  const newLines: string[] = [];
  for (let i = 0; i < looseZoneEnd; i++) {
    const trimmed = lines[i].trim();
    if (isBulletLine(trimmed)) {
      const norm = normalizeBullet(trimmed);
      if (!isTombstoneBullet(norm) && wantedSet.has(norm)) {
        continue; // drop this loose bullet
      }
    }
    newLines.push(lines[i]);
  }
  // Re-attach the rest of the body.
  for (let i = looseZoneEnd; i < lines.length; i++) {
    newLines.push(lines[i]);
  }

  const newBody = newLines.join("\n");
  sections[idx] = {
    heading: sections[idx].heading,
    content: `${headingLine}\n${newBody}`,
  };
  const docAfterDelete = sections.map((s) => s.content).join("");

  // Now append the new subsection to that doc using the existing helper.
  return appendNewSubsection(
    docAfterDelete,
    sectionTitle,
    subsectionName,
    prose,
    bullets,
  );
}

/**
 * Append a `- ⚠ Possibly outdated: <fact>` bullet at the bottom of a
 * section's content area, just before any `[Confidence: …]` line. No-op if
 * the section doesn't exist. Tombstones are never deduped.
 */
export function appendTombstone(
  doc: string,
  sectionTitle: string,
  originalFact: string,
): string {
  return rewriteSectionBody(doc, sectionTitle, (body) => {
    const lines = body.split("\n");
    const confidenceIdx = lines.findIndex((l) =>
      l.trim().startsWith("[Confidence:"),
    );
    const tombstoneLine = `- ⚠ Possibly outdated: ${originalFact}`;
    if (confidenceIdx === -1) {
      // Append at end, trimming trailing blanks first so we don't grow them.
      let endIdx = lines.length;
      while (endIdx > 0 && lines[endIdx - 1].trim() === "") endIdx--;
      lines.splice(endIdx, 0, "", tombstoneLine);
    } else {
      // Insert one blank line + tombstone before the [Confidence:] line.
      lines.splice(confidenceIdx, 0, tombstoneLine, "");
    }
    return lines.join("\n");
  });
}

/**
 * Pure-code dispatcher that turns an LLM placement decision into a doc edit.
 * The orchestrator passes a `looseIdToText` mapping built from the same
 * `parseSectionStructure` call that produced the LLM input — this is how
 * `promote_to_new_subsection` resolves L-IDs back to bullet texts to delete.
 *
 * Falls back gracefully:
 *   - skip → no-op
 *   - promote with no resolvable IDs → add_to_loose_facts using the new fact
 *   - any decision against a missing section → no-op via the underlying
 *     bullet-op functions
 */
export function applyPlacementDecision(
  doc: string,
  sectionTitle: string,
  decision: PlacementDecision,
  looseIdToText: Map<string, string> = new Map(),
): string {
  switch (decision.decision) {
    case "skip":
      return doc;

    case "append_to_subsection":
      return appendBulletToSubsection(
        doc,
        sectionTitle,
        decision.subsection,
        decision.bullet,
      );

    case "add_to_loose_facts":
      return appendLooseFactBullet(doc, sectionTitle, decision.bullet);

    case "promote_to_new_subsection": {
      const looseTextsToRemove: string[] = [];
      for (const id of decision.promoted_loose_ids) {
        const text = looseIdToText.get(id);
        if (text) looseTextsToRemove.push(text);
      }
      if (looseTextsToRemove.length === 0) {
        // Fallback: drop the new fact in as a loose bullet so we don't lose it.
        const newFactBullet = decision.bullets[0] ?? "";
        if (!newFactBullet) return doc;
        return appendLooseFactBullet(doc, sectionTitle, newFactBullet);
      }
      return promoteLooseFactsToSubsection(
        doc,
        sectionTitle,
        looseTextsToRemove,
        decision.subsection,
        decision.prose,
        decision.bullets,
      );
    }
  }
}
