/**
 * Aspect-Based Persona Generation
 *
 * Generates persona document by:
 * 1. Fetching statements grouped by aspect from the knowledge graph
 * 2. Getting provenance episodes for context
 * 3. Generating each section independently based on aspect
 * 4. Combining into final persona document
 *
 * No BERT/HDBSCAN clustering - uses graph structure directly
 */

import { logger } from "~/services/logger.service";
import { createBatch, getBatch } from "~/lib/batch.server";
import { createAgent, resolveModelString } from "~/lib/model.server";
import { z } from "zod";

// Flag to bypass the OpenAI batch API and run full-refresh through direct
// chat completions instead. Useful for local/dev iteration where waiting
// minutes-to-hours for a batch is impractical. Defaults to batch in prod.
//   PERSONA_USE_BATCH=false  → direct mode (sync calls per request)
//   PERSONA_USE_BATCH unset/true → batch mode (existing behaviour)
const USE_BATCH = false;

async function directLLMCall(message: ModelMessage): Promise<string | null> {
  try {
    const modelId = await resolveModelString("chat", "medium");
    const agent = createAgent(modelId);
    const result = await agent.generate(message);
    return result.text ?? null;
  } catch (err) {
    logger.error("directLLMCall failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}
import {
  getUserContext,
  type UserContext,
} from "~/services/user-context.server";
import {
  type StatementAspect,
  type StatementNode,
  type EpisodicNode,
  VOICE_ASPECTS,
} from "@core/types";
import { ProviderFactory } from "@core/providers";
import { getActiveVoiceAspects } from "~/services/aspectStore.server";

import { type ModelMessage } from "ai";

// Minimum statements required to generate a section
// Set to 1 so even a single fact gets included.
const MIN_STATEMENTS_PER_SECTION = 1;

// Chunking limits for large sections
const MAX_STATEMENTS_PER_CHUNK = 30;
const MAX_EPISODES_PER_CHUNK = 20;

// Aspects to skip entirely from persona generation
// Event: Transient calendar/schedule data - agents can query graph directly for specific dates
const SKIPPED_ASPECTS: StatementAspect[] = [
  "Event",
  "Relationship",
  "Knowledge",
  "Belief",
  "Habit",
  "Goal",
  "Decision",
  "Problem",
  "Task",
];

// ─── Markdown section helpers ───────────────────────────────────────
// Split/merge persona documents by ## headings — same pattern as
// task pages use splitByH2/mergeSectionIntoHtml but for markdown.
// Unknown sections are always preserved verbatim.

interface MarkdownSection {
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
  // Match ## at start of line (not ### or deeper)
  const h2Regex = /^## /gm;
  const positions: number[] = [];
  let m: RegExpExecArray | null;

  while ((m = h2Regex.exec(doc)) !== null) {
    positions.push(m.index);
  }

  if (positions.length === 0) {
    // No ## headings — entire doc is the header
    return [{ heading: null, content: doc }];
  }

  // Content before the first ## heading
  if (positions[0] > 0) {
    sections.push({ heading: null, content: doc.slice(0, positions[0]) });
  }

  for (let i = 0; i < positions.length; i++) {
    const start = positions[i];
    const end = i + 1 < positions.length ? positions[i + 1] : doc.length;
    const raw = doc.slice(start, end);

    // Extract heading text from the first line: "## IDENTITY\n..." → "IDENTITY"
    const firstNewline = raw.indexOf("\n");
    const headingLine = firstNewline >= 0 ? raw.slice(3, firstNewline) : raw.slice(3);
    sections.push({ heading: headingLine.trim(), content: raw });
  }

  return sections;
}

/**
 * Find a section by heading name (case-insensitive), replace its body content
 * (everything after the ## heading line), and return the full document.
 * If the section doesn't exist, append it. All other sections are preserved verbatim.
 */
export function mergeSectionIntoMarkdown(
  doc: string,
  sectionName: string,
  newBody: string,
): string {
  const sections = splitByH2Markdown(doc);

  const targetIndex = sections.findIndex(
    (s) => s.heading?.toUpperCase() === sectionName.toUpperCase(),
  );

  if (targetIndex >= 0) {
    // Replace the section body, keep the ## heading line
    sections[targetIndex] = {
      heading: sectionName,
      content: `## ${sectionName}\n\n${newBody}\n\n`,
    };
  } else {
    // Append new section at the end
    sections.push({
      heading: sectionName,
      content: `## ${sectionName}\n\n${newBody}\n\n`,
    });
  }

  return sections.map((s) => s.content).join("");
}

/**
 * Strip structural markdown headings (# and ##) from LLM output.
 * Prevents the LLM from injecting duplicate document/section headers.
 * Preserves ### sub-headers which are valid within section content.
 *
 * Only run this on LLM-produced text, not on the user-visible existing body —
 * collapsing blank lines and stripping headings on user-edited content is a
 * silent edit-loss path.
 */
function sanitizeSectionContent(content: string): string {
  return content
    .replace(/^#{1,2}\s+.*$/gm, "") // strip # and ## lines
    .replace(/<!-- section:\w+ -->/g, "") // strip legacy markers
    .replace(/\n{3,}/g, "\n\n") // collapse excessive blank lines
    .trim();
}

/**
 * Lighter sanitizer for existing section bodies fed back into the LLM prompt.
 * Only strips legacy `<!-- section:X -->` round-trip markers — never touches
 * headings or blank lines, since the user may have added structure inside
 * the section.
 */
function stripLegacySectionMarkers(content: string): string {
  return content.replace(/<!-- section:\w+ -->/g, "").trim();
}

/**
 * Extract the body content of a ## section (everything after the heading line).
 */
function getSectionBody(sectionContent: string): string {
  const firstNewline = sectionContent.indexOf("\n");
  if (firstNewline < 0) return "";
  return sectionContent.slice(firstNewline + 1).trim();
}

// Aspect to persona section mapping with filtering guidance
// Each section answers a specific question an AI agent might have
export const ASPECT_SECTION_MAP: Record<
  StatementAspect,
  {
    title: string;
    description: string;
    agentQuestion: string;
    filterGuidance: string;
  }
> = {
  Identity: {
    title: "IDENTITY",
    description:
      "Who they are - name, role, affiliations, contact info, location",
    agentQuestion: "Who am I talking to?",
    filterGuidance: `Rule: a fact belongs in IDENTITY if and only if an agent needs it on EVERY task to act on the user's behalf — to introduce, address, contact, or attribute correctly — regardless of what the task is about.

Apply this test:
  > "If the user just asked something completely unrelated, would I still need this fact loaded?"
  > If yes → keep. If no → drop; memory will retrieve it when the task is specifically about that thing.

Anchors:
  Keep — "primary email manoj@poozle.dev", "employer Polarize Labs LLP", "GitHub handle saimanoj"
  Drop — "31% body fat", "card ending 7108", "subscribed to Birkenstock", "owns RedPlanetHQ/sol"

When in doubt about a durable identifier (a secondary email, an affiliation, a public handle), keep it. The gate's drop rules still apply for everything else.`,
  },
  Knowledge: {
    title: "EXPERTISE",
    description: "What they know - skills, technologies, domains, tools",
    agentQuestion: "What do they know? (So I calibrate complexity)",
    filterGuidance:
      "Include: all technical skills, domain expertise, tools, platforms, frameworks they work with. Any agent might need to know their capability level.",
  },
  Belief: {
    title: "WORLDVIEW",
    description: "Core values, opinions, principles they hold",
    agentQuestion: "What do they believe? (So I align with their values)",
    filterGuidance:
      "Include: core values, strong opinions, guiding principles, philosophies. These shape how agents should frame suggestions.",
  },
  Preference: {
    title: "PREFERENCES",
    description: "How they want things done - style, format, approach, tools",
    agentQuestion: "How do they want things done?",
    filterGuidance: `Rule: a fact belongs in PREFERENCES if and only if an agent applies it on EVERY future task where the dimension is relevant — independent of which tool, feature, or project the task is about.

Apply this test:
  > "Would a future agent, working on something completely unrelated to where this preference came from, still apply it?"
  > If no → drop.

Anchors:
  Keep — "direct, founder tone in all writing", "drafts important messages for approval"
  Drop — "Linear widget shows assigned issues", "v1 ships with column-by-column filter", "Email N stops sequence"

Hard non-negotiable rules belong in DIRECTIVES, not here.`,
  },
  Habit: {
    title: "HABITS",
    description: "Regular habits, workflows, routines - work and personal",
    agentQuestion: "What do they do regularly? (So I fit into their life)",
    filterGuidance:
      "Include: recurring habits, established workflows, routines (work, health, personal). Exclude: one-time completed actions.",
  },
  Goal: {
    title: "GOALS",
    description: "What they're trying to achieve - work, health, personal",
    agentQuestion: "What are they trying to achieve? (So I align suggestions)",
    filterGuidance:
      "Include: all ongoing objectives across work, health, personal life. Exclude: completed goals, past deliverables.",
  },
  Directive: {
    title: "DIRECTIVES",
    description:
      "Standing rules and active decisions - always do X, never do Y, use Z for W",
    agentQuestion: "What rules must I follow? What's already decided?",
    filterGuidance: `Rule: a fact belongs in DIRECTIVES if and only if violating it would be a defect on ANY future task — not just on the feature, schedule, or workflow it came from.

Apply this test:
  > "If an agent on a totally unrelated task ignored this rule, would that be a bug?"
  > If yes → keep. If no → drop; that's feature config, not a persona directive.

The "always/never" wording is a trap — any feature config can be phrased as "always X" and sound directive-shaped. The test is about scope of authority, not wording.

Anchors:
  Keep — "never auto-send messages", "draft before sending anything", "read-only SQL", "use IST as default timezone"
  Drop — "Email N empty stops sequence", "Plan My Day runs at 5:15 PM IST", "modify decision-agent.ts", "schema.prisma sync in CI"

Format kept rules as actionable: "Always …", "Never …", "Use X for Y".`,
  },
  Decision: {
    title: "DECISIONS",
    description: "Choices already made - don't re-litigate these",
    agentQuestion: "What's already decided? (Don't suggest alternatives)",
    filterGuidance:
      "Include: all active decisions (technology, architecture, strategy, lifestyle). Agents should not suggest alternatives to decided matters.",
  },
  Event: {
    title: "TIMELINE",
    description: "Key events and milestones",
    agentQuestion: "What happened when?",
    filterGuidance:
      "SKIP - Transient data. Agents should query the graph directly for date-specific information.",
  },
  Problem: {
    title: "CHALLENGES",
    description: "Current blockers, struggles, areas needing attention",
    agentQuestion: "What's blocking them? (Where can I help?)",
    filterGuidance:
      "Include: all ongoing challenges, pain points, blockers. Exclude: resolved issues.",
  },
  Relationship: {
    title: "RELATIONSHIPS",
    description:
      "Key people - names, roles, contact info, how to work with them",
    agentQuestion: "Who matters to them? (Context for names mentioned)",
    filterGuidance:
      "Include: names, roles, relationships, contact info (email, phone), collaboration notes. Any agent might need to reference or contact these people.",
  },
  Task: {
    title: "TASKS",
    description: "One-time commitments, follow-ups, promises, action items",
    agentQuestion: "What do they need to do?",
    filterGuidance:
      "SKIP - Transient data. Agents should query the graph directly for tasks and action items.",
  },
};

// Zod schema for section generation
const SectionContentSchema = z.object({
  content: z.string(),
});

export interface AspectData {
  aspect: StatementAspect;
  statements: StatementNode[];
  episodes: EpisodicNode[];
}

export interface PersonaSectionResult {
  aspect: StatementAspect;
  title: string;
  content: string;
  statementCount: number;
  episodeCount: number;
}

interface ChunkData {
  statements: StatementNode[];
  episodes: EpisodicNode[];
  chunkIndex: number;
  totalChunks: number;
  isLatest: boolean;
}

/**
 * Fetch statements grouped by aspect with their provenance episodes.
 * Also fetches voice aspects from the Aspects Store and merges them
 * as synthetic statements for persona-relevant voice aspects (Preference, Directive).
 */
export async function getStatementsByAspectWithEpisodes(
  userId: string,
): Promise<Map<StatementAspect, AspectData>> {
  const graphProvider = ProviderFactory.getGraphProvider();

  // Query to get all valid statements grouped by aspect with their episodes
  const query = `
    MATCH (s:Statement {userId: $userId})
    WHERE s.invalidAt IS NULL AND s.aspect IS NOT NULL
    MATCH (e:Episode)-[:HAS_PROVENANCE]->(s)
    WITH s.aspect AS aspect,
         collect(DISTINCT {
           uuid: s.uuid,
           fact: s.fact,
           createdAt: s.createdAt,
           validAt: s.validAt,
           attributes: s.attributes,
           aspect: s.aspect
         }) AS statements,
         collect(DISTINCT {
           uuid: e.uuid,
           content: e.content,
           originalContent: e.originalContent,
           source: e.source,
           createdAt: e.createdAt,
           validAt: e.validAt
         }) AS episodes
    RETURN aspect, statements, episodes
    ORDER BY aspect
  `;

  // Fetch graph statements and voice aspects in parallel
  const voiceAspectSet = new Set<string>(VOICE_ASPECTS);
  const [results, voiceAspectNodes] = await Promise.all([
    graphProvider.runQuery(query, { userId }),
    getActiveVoiceAspects({ userId, limit: 200 }),
  ]);

  const aspectDataMap = new Map<StatementAspect, AspectData>();

  for (const record of results) {
    const aspect = record.get("aspect") as StatementAspect;
    const rawStatements = record.get("statements") as any[];
    const rawEpisodes = record.get("episodes") as any[];

    // Parse statements
    const statements: StatementNode[] = rawStatements.map((s) => ({
      uuid: s.uuid,
      fact: s.fact,
      factEmbedding: [],
      createdAt: new Date(s.createdAt),
      validAt: new Date(s.validAt),
      invalidAt: null,
      attributes:
        typeof s.attributes === "string"
          ? JSON.parse(s.attributes)
          : s.attributes || {},
      userId,
      aspect: s.aspect,
    }));

    // Parse episodes
    const episodes: EpisodicNode[] = rawEpisodes.map((e) => ({
      uuid: e.uuid,
      content: e.content,
      originalContent: e.originalContent || e.content,
      source: e.source,
      metadata: {},
      createdAt: new Date(e.createdAt),
      validAt: new Date(e.validAt),
      labelIds: [],
      userId,
      sessionId: "",
    }));

    aspectDataMap.set(aspect, { aspect, statements, episodes });
  }

  // Merge voice aspects as synthetic statements into their matching aspect groups
  if (voiceAspectNodes.length > 0) {
    for (const va of voiceAspectNodes) {
      if (!voiceAspectSet.has(va.aspect)) continue;

      const aspect = va.aspect as StatementAspect;
      const syntheticStatement: StatementNode = {
        uuid: va.uuid,
        fact: va.fact,
        factEmbedding: [],
        createdAt: va.createdAt,
        validAt: va.validAt,
        invalidAt: null,
        attributes: {},
        userId,
        aspect,
      };

      const existing = aspectDataMap.get(aspect);
      if (existing) {
        // Avoid duplicates — only add if fact doesn't already exist
        const factExists = existing.statements.some((s) => s.fact === va.fact);
        if (!factExists) {
          existing.statements.push(syntheticStatement);
        }
      } else {
        aspectDataMap.set(aspect, {
          aspect,
          statements: [syntheticStatement],
          episodes: [],
        });
      }
    }

    logger.info(
      `Merged ${voiceAspectNodes.length} voice aspects into aspect data`,
    );
  }

  return aspectDataMap;
}

// Shared persona-worthiness gate. Mirrors the per-fact gate in
// persona-llm-placement.ts. Goal: even when an upstream classifier has
// labelled facts as Identity/Preference/Directive, MOST of them should
// still be skipped — the label is necessary, not sufficient. The gate
// is repeated in every full-mode prompt so chunk summaries, merge, and
// single-section calls all apply the same filter.
const PERSONA_WORTHINESS_GATE = `
=========================================================
PERSONA-WORTHINESS GATE — apply BEFORE writing anything
=========================================================

The persona is a small, durable operating manual for OTHER AGENTS —
agents that have no knowledge of the conversation that produced these
facts, working on UNRELATED future tasks. The label upstream is
NECESSARY but NOT SUFFICIENT — most labelled facts will still fail
this gate. Default is drop.

----------- THE UNIFIED RULE -----------

A fact is persona-worthy if and only if an agent would apply it on
EVERY future task where its dimension is relevant — independent of the
specific tool, feature, project, schedule, or episode the fact came
from.

Apply this single test to every fact:

  > "Would a fresh agent, working on something completely unrelated
  > to where this fact came from, still need this fact to act
  > correctly?"
  > If no → drop.

Aspect-specific reading of the rule:
  - IDENTITY  → keep if an agent needs it on every task to act on the
                user's behalf (introduce, address, contact, attribute).
                Drop possessions, biometrics, account/policy numbers,
                workload counts — those are about the user but only
                relevant when the task is specifically about that
                thing; memory will retrieve them when needed.
  - PREFERENCE → keep if it shapes agent behaviour across many tools,
                features, and tasks. Drop preferences scoped to one
                tool/feature/episode.
  - DIRECTIVE → keep if its violation would be a defect on ANY future
                task. Drop rules whose authority is scoped to one
                feature/file/job — that's feature config, not persona.

Anchors (apply to all aspects):
  Keep — "primary email manoj@poozle.dev", "founder tone in writing",
         "never auto-send messages", "use IST as default timezone"
  Drop — "31% body fat", "Linear widget shows assigned issues",
         "Email N column stops sequence", "Plan My Day at 5:15 PM IST",
         "modify decision-agent.ts", "subscribed to Birkenstock"

----------- WORKING HEURISTIC -----------

If a fact mentions a NAMED artifact — a specific tool, widget, file,
function, repo, ticket, column, schedule, job, workflow, gateway,
pipeline stage — that's a strong signal it's feature config, not
persona. Drop unless the rule it expresses clearly applies far beyond
that one artifact.

If you'd name a subsection after a feature, workflow, or schedule
("Email sequence", "Linear widget", "Gmail monitor", "Plan mode",
"Recurring runs", "Sheet status", etc.), the cluster itself is
feature config. Drop every fact in it.

When in doubt, drop. The persona stays useful by staying small.
`.trim();

/**
 * Build prompt for generating a single aspect section
 */
function buildAspectSectionPrompt(
  aspectData: AspectData,
  userContext: UserContext,
): ModelMessage {
  const { aspect, statements, episodes } = aspectData;
  const sectionInfo = ASPECT_SECTION_MAP[aspect];

  // Format facts as structured list
  const factsText = statements.map((s, i) => `${i + 1}. ${s.fact}`).join("\n");

  // Format episodes for context (limit to avoid token overflow)
  const maxEpisodes = Math.min(episodes.length, 10);
  const episodesText = episodes
    .slice(0, maxEpisodes)
    .map((e, i) => {
      const date = new Date(e.createdAt).toISOString().split("T")[0];
      return `[${date}] ${e.content}`;
    })
    .join("\n\n---\n\n");

  const content = `
You are generating the **${sectionInfo.title}** section of a persona document.

${PERSONA_WORTHINESS_GATE}

## What is a Persona Document?

A persona is NOT a summary of everything known about a person. It is an **operating manual** for AI agents to interact with this person effectively.

**Core principle:** Every line must change how an agent behaves across many UNRELATED future interactions. If removing a line wouldn't change agent behaviour in some other, unrelated future task, drop the line.

Think of it as a quick reference card, not a biography or database dump.

## Why This Section Exists

The **${sectionInfo.title}** section answers: "${sectionInfo.agentQuestion}"

${sectionInfo.description}

## User Context
${userContext.name ? `- Name: ${userContext.name}` : ""}
${userContext.role ? `- Role: ${userContext.role}` : ""}
${userContext.goal ? `- Goal: ${userContext.goal}` : ""}

## Raw Facts (${statements.length} statements)

You will see the raw facts below. APPLY THE GATE TO EACH FACT. Most labelled facts will fail the gate. The output should reflect that — sections that look thin are FINE, sections that look complete-but-noisy are NOT fine.

${factsText}

## Source Episodes (for context)
${episodesText}

## Aspect-specific filter

${sectionInfo.filterGuidance}

## Output Requirements

The output is a structured section body with these elements (in order):

1. (Optional) Loose-fact bullets at the very top — facts that don't cluster
   into a clear topic with at least one sibling. Format: \`- \${sentence}\`.

2. (Required, when there are clusterable topics) Zero or more \`### Subsection\` blocks. Each subsection is a
   topic cluster — group facts that share a coherent theme (e.g. "Email
   writing", "Code style"). Each subsection has:
   - A 1-3 sentence prose paragraph capturing contextual nuance, conditional
     behaviour, and relationships between the clustered facts.
   - A blank line.
   - One bullet per fact, format \`- \${sentence}\`.
   - One blank line between bullets and the next subsection.

3. The line \`[Confidence: HIGH|MEDIUM|LOW]\` at the very end of the section.

## Subsection naming

- 1-3 words, topic-shaped (e.g., "Email writing", "Code style", "Onboarding")
- No special characters except "-" or "/"
- Avoid duplicating subsection names within a section

## When to cluster

A topic with only ONE fact stays as a loose bullet at the top — do not create
a subsection for a single-fact topic. A cluster needs ≥ 2 related facts that
ALL pass the gate.

NEVER create a subsection whose name is the name of a feature, integration,
workflow, or job. If the only way to name the cluster is by feature ("Linear
widgets", "Email sequence", "Skill pipeline", "Gmail monitor", "Recurring
runs", "Sheet status", "Plan mode", "Outbound email"), the cluster itself
is feature config — DROP every fact in it.

Saturation: if you find yourself with ≥ 8 subsections in this section, stop
adding new ones. Drop further facts that don't unambiguously belong to one
of the existing subsections.

## What to Include vs Exclude

✅ INCLUDE only if all of these are true:
- Applies across MANY future, unrelated interactions
- No named feature/widget/file/repo/issue/schedule
- Describes BEHAVIOUR an agent should follow, not an OBSERVATION about the user
- Not already covered by another fact in the section

❌ EXCLUDE — drop without exception:
- Body composition, biometrics, physical stats
- Possessions, hardware, subscriptions, account/policy/order/card numbers
- Project work, repo/issue/PR/ticket mentions, file or function references
- Per-job schedules and cron times (e.g. "runs at 5:30 PM IST")
- Per-feature setup ("widget shows X", "column N triggers Y", "step Z")
- Implementation guidance for one specific kind of task
- Anything an agent can get from memory search at runtime

## Identity-specific guidance

For Identity specifically: if no clear sub-topics exist, emit a single
unnamed prose paragraph (1-3 sentences, biographical) at the top of the
section, above all bullets and any \`### subsection\` blocks. Then end with
\`[Confidence: …]\`.

## Bullet length

- Bullets are single sentences, ≤ 20 words for Preferences, ≤ 10 words for other aspects
- Active voice, no leading dash in your output (the dash is added by the format)
- No "I prefer" / "User does" prefixes — just the rule or fact

Even if there is only 1 fact, generate the section — do NOT return "INSUFFICIENT_DATA".

Generate ONLY the section content, no title header.
  `.trim();

  return { role: "user", content };
}

/**
 * Build prompt for generating a chunk summary (for large sections)
 */
function buildChunkSummaryPrompt(
  aspect: StatementAspect,
  chunk: ChunkData,
  userContext: UserContext,
): ModelMessage {
  const sectionInfo = ASPECT_SECTION_MAP[aspect];

  // Format facts
  const factsText = chunk.statements
    .map((s, i) => `${i + 1}. ${s.fact}`)
    .join("\n");

  // Format episodes
  const episodesText = chunk.episodes
    .map((e) => {
      const date = new Date(e.createdAt).toISOString().split("T")[0];
      return `[${date}] ${e.content}`;
    })
    .join("\n\n---\n\n");

  const recencyNote = chunk.isLatest
    ? "**This is the MOST RECENT chunk** - this information is the most current and should be weighted heavily."
    : `This is chunk ${chunk.chunkIndex + 1} of ${chunk.totalChunks} (older data).`;

  const content = `
You are summarizing a chunk of data for the **${sectionInfo.title}** section of a persona document.

${recencyNote}

${PERSONA_WORTHINESS_GATE}

## Section Purpose
${sectionInfo.agentQuestion}

## Aspect-specific filter
${sectionInfo.filterGuidance}

## Facts in this chunk (${chunk.statements.length} statements)

APPLY THE GATE TO EACH FACT. Most facts here will fail the gate — that is
correct. Drop them silently; do NOT carry them through.

${factsText}

## Source Episodes (for context)
${episodesText}

## Instructions

After applying the gate, cluster the SURVIVING facts by topic (1-3 word
topic names). For each cluster of ≥ 2 SURVIVING facts that share a STANDING
topic (not a feature/widget/workflow), output a small block:

  TOPIC: <name>
  PROSE: <1-3 sentences capturing contextual nuance>
  BULLETS:
  - fact one
  - fact two

NEVER name a TOPIC after a feature, integration, workflow, schedule, file,
or repo. If the natural cluster name is feature-shaped, the cluster is
feature config — drop it entirely.

For solo SURVIVING facts that don't cluster, emit:

  LOOSE: <fact>

Return one such block per topic cluster or solo fact. The merge step will
combine these into the final structured section. If after applying the gate
NO facts survive, return "NO_PATTERNS".
  `.trim();

  return { role: "user", content };
}

/**
 * Build prompt for merging chunk summaries into final section
 */
function buildMergePrompt(
  aspect: StatementAspect,
  chunkSummaries: string[],
  userContext: UserContext,
): ModelMessage {
  const sectionInfo = ASPECT_SECTION_MAP[aspect];

  // Format summaries with recency labels
  const summariesText = chunkSummaries
    .map((summary, i) => {
      const recencyLabel =
        i === 0 ? "MOST RECENT (highest priority)" : `Older chunk ${i + 1}`;
      return `### ${recencyLabel}\n${summary}`;
    })
    .join("\n\n");

  const content = `
You are merging chunk summaries into the final **${sectionInfo.title}** section of a persona document.

${PERSONA_WORTHINESS_GATE}

## What is a Persona Document?

A persona is an **operating manual** for AI agents. Every line must change how an agent behaves across many UNRELATED future tasks.

## Section Purpose
The **${sectionInfo.title}** section answers: "${sectionInfo.agentQuestion}"

## Aspect-specific filter
${sectionInfo.filterGuidance}

## Chunk Summaries (ordered by recency)

The chunks below have already been filtered, but the filter may have let
some feature-config / observation facts through. Apply the gate AGAIN as
you merge — drop any TOPIC whose name is feature/widget/workflow shaped,
drop any LOOSE entry that fails the gate. Do NOT promote feature-shaped
TOPICs into ### subsections.

${summariesText}

## Output Format

The merged output uses the same structured format as a fresh section body:

1. (Optional) Loose-fact bullets at the very top — combine all LOOSE entries
   from chunks. Format: \`- \${sentence}\`.

2. Zero or more \`### Subsection\` blocks built by combining matching TOPICs
   across chunks:
   - If the same topic appears in multiple chunks, merge their BULLETS lists
     (deduplicating identical or near-identical facts, recent chunk wins).
   - For PROSE: prefer the most recent chunk's prose when available; otherwise
     synthesise a 1-3 sentence summary covering all the merged facts.
   - Each subsection is: \`### Topic Name\`, blank line, prose paragraph,
     blank line, one bullet per fact (format \`- \${sentence}\`), blank line.

3. End with \`[Confidence: HIGH|MEDIUM|LOW]\`.

## Bullet length

- Bullets are single sentences, ≤ 20 words for Preferences, ≤ 10 words for other aspects
- Active voice, no "I prefer" / "User does" prefixes
- Subsection names: 1-3 words, topic-shaped, no duplicates

## Merge rules

1. Recent info takes precedence — if there's a conflict, the most recent chunk wins.
2. Deduplicate identical bullets across chunks.
3. Preserve important older info — older facts stay unless contradicted.
4. The final output should be shorter than the sum of chunks.

Generate ONLY the section content, no title header.
  `.trim();

  return { role: "user", content };
}

/**
 * Split aspect data into chunks, sorted by recency (most recent first)
 */
function chunkAspectData(aspectData: AspectData): ChunkData[] {
  const { statements, episodes } = aspectData;

  // Sort by createdAt descending (most recent first)
  const sortedStatements = [...statements].sort(
    (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
  );
  const sortedEpisodes = [...episodes].sort(
    (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
  );

  // Calculate number of chunks needed
  const numChunks = Math.max(
    Math.ceil(sortedStatements.length / MAX_STATEMENTS_PER_CHUNK),
    1,
  );

  const chunks: ChunkData[] = [];

  for (let i = 0; i < numChunks; i++) {
    const stmtStart = i * MAX_STATEMENTS_PER_CHUNK;
    const stmtEnd = Math.min(
      stmtStart + MAX_STATEMENTS_PER_CHUNK,
      sortedStatements.length,
    );

    const epStart = i * MAX_EPISODES_PER_CHUNK;
    const epEnd = Math.min(
      epStart + MAX_EPISODES_PER_CHUNK,
      sortedEpisodes.length,
    );

    chunks.push({
      statements: sortedStatements.slice(stmtStart, stmtEnd),
      episodes: sortedEpisodes.slice(epStart, epEnd),
      chunkIndex: i,
      totalChunks: numChunks,
      isLatest: i === 0,
    });
  }

  return chunks;
}

/**
 * Generate section with chunking for large datasets
 */
async function generateSectionWithChunking(
  aspectData: AspectData,
  userContext: UserContext,
): Promise<string | null> {
  const { aspect, statements, episodes } = aspectData;
  const sectionInfo = ASPECT_SECTION_MAP[aspect];

  if (!sectionInfo) {
    logger.warn(
      `No section mapping for aspect "${aspect}" — skipping chunking`,
    );
    return null;
  }

  // Check if chunking is needed
  const needsChunking = statements.length > MAX_STATEMENTS_PER_CHUNK;

  if (!needsChunking) {
    // Small section - generate directly (existing logic will handle this)
    return null; // Signal to use direct generation
  }

  logger.info(`Section ${aspect} needs chunking`, {
    statements: statements.length,
    chunks: Math.ceil(statements.length / MAX_STATEMENTS_PER_CHUNK),
  });

  // Split into chunks
  const chunks = chunkAspectData(aspectData);

  // Generate summary for each chunk — batch or direct based on flag.
  const chunkSummaries: string[] = [];

  if (USE_BATCH) {
    const chunkRequests = chunks.map((chunk) => ({
      customId: `chunk-${aspect}-${chunk.chunkIndex}-${Date.now()}`,
      messages: [buildChunkSummaryPrompt(aspect, chunk, userContext)],
      systemPrompt: "",
    }));

    const { batchId: chunkBatchId } = await createBatch({
      requests: chunkRequests,
      outputSchema: SectionContentSchema,
      maxRetries: 3,
      timeoutMs: 1200000,
    });

    const chunkBatch = await pollBatchCompletion(chunkBatchId, 1200000);

    if (!chunkBatch.results || chunkBatch.results.length === 0) {
      logger.warn(`No chunk results for ${aspect}`);
      return null;
    }

    for (const result of chunkBatch.results) {
      if (result.error || !result.response) continue;
      const content =
        typeof result.response === "string"
          ? result.response
          : result.response.content || "";
      if (!content.includes("NO_PATTERNS")) {
        chunkSummaries.push(content);
      }
    }
  } else {
    // Direct mode: fan out chunk summaries in parallel via plain LLM calls.
    const directResults = await Promise.all(
      chunks.map((chunk) =>
        directLLMCall(buildChunkSummaryPrompt(aspect, chunk, userContext)),
      ),
    );
    for (const content of directResults) {
      if (content && !content.includes("NO_PATTERNS")) {
        chunkSummaries.push(content);
      }
    }
  }

  if (chunkSummaries.length === 0) {
    logger.info(`No patterns found in any chunk for ${aspect}`);
    return "INSUFFICIENT_DATA";
  }

  // If only one chunk had content, use it directly
  if (chunkSummaries.length === 1) {
    return chunkSummaries[0];
  }

  // Merge chunk summaries — batch or direct.
  if (USE_BATCH) {
    const mergeRequest = {
      customId: `merge-${aspect}-${Date.now()}`,
      messages: [buildMergePrompt(aspect, chunkSummaries, userContext)],
      systemPrompt: "",
    };

    const { batchId: mergeBatchId } = await createBatch({
      requests: [mergeRequest],
      outputSchema: SectionContentSchema,
      maxRetries: 3,
      timeoutMs: 1200000,
    });

    const mergeBatch = await pollBatchCompletion(mergeBatchId, 1200000);

    if (!mergeBatch.results || mergeBatch.results.length === 0) {
      logger.warn(`No merge result for ${aspect}`);
      return chunkSummaries[0];
    }

    const mergeResult = mergeBatch.results[0];
    if (mergeResult.error || !mergeResult.response) {
      return chunkSummaries[0];
    }

    return typeof mergeResult.response === "string"
      ? mergeResult.response
      : mergeResult.response.content || chunkSummaries[0];
  }

  const merged = await directLLMCall(
    buildMergePrompt(aspect, chunkSummaries, userContext),
  );
  return merged ?? chunkSummaries[0];
}

/**
 * Generate all aspect sections in parallel batches
 */
async function generateAllAspectSections(
  aspectDataMap: Map<StatementAspect, AspectData>,
  userContext: UserContext,
): Promise<PersonaSectionResult[]> {
  const sections: PersonaSectionResult[] = [];

  // Filter aspects with enough data and not in skip list
  const aspectsToProcess: AspectData[] = [];
  const largeAspects: AspectData[] = [];
  const smallAspects: AspectData[] = [];

  for (const [aspect, data] of aspectDataMap) {
    // Skip aspects that shouldn't be in persona (e.g., Event - transient data)
    if (SKIPPED_ASPECTS.includes(aspect)) {
      logger.info(
        `Skipping ${aspect} - excluded from persona generation (transient data)`,
      );
      continue;
    }

    if (data.statements.length >= MIN_STATEMENTS_PER_SECTION) {
      aspectsToProcess.push(data);

      // Separate large sections that need chunking
      if (data.statements.length > MAX_STATEMENTS_PER_CHUNK) {
        largeAspects.push(data);
      } else {
        smallAspects.push(data);
      }
    } else {
      logger.info(
        `Skipping ${aspect} - only ${data.statements.length} statements`,
      );
    }
  }

  if (aspectsToProcess.length === 0) {
    logger.warn("No aspects have sufficient data for persona generation");
    return [];
  }

  logger.info(`Processing sections`, {
    total: aspectsToProcess.length,
    small: smallAspects.length,
    large: largeAspects.length,
    largeAspects: largeAspects.map(
      (a) => `${a.aspect}(${a.statements.length})`,
    ),
  });

  // Run all sections in parallel - large (chunked) and small (single batch) concurrently
  const parallelTasks: Promise<PersonaSectionResult[]>[] = [];

  // Task for each large section (chunking handled internally)
  for (const aspectData of largeAspects) {
    parallelTasks.push(
      generateSectionWithChunking(aspectData, userContext).then((content) => {
        if (content && !content.includes("INSUFFICIENT_DATA")) {
          const sectionInfo = ASPECT_SECTION_MAP[aspectData.aspect];
          return [
            {
              aspect: aspectData.aspect,
              title: sectionInfo.title,
              content,
              statementCount: aspectData.statements.length,
              episodeCount: aspectData.episodes.length,
            },
          ];
        }
        return [];
      }),
    );
  }

  // Task for all small sections in a single batch
  if (smallAspects.length > 0) {
    parallelTasks.push(
      (async () => {
        const sortedSmallAspects = smallAspects.map((aspectData) => ({
          ...aspectData,
          statements: [...aspectData.statements].sort(
            (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
          ),
          episodes: [...aspectData.episodes].sort(
            (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
          ),
        }));

        const results: PersonaSectionResult[] = [];

        if (USE_BATCH) {
          const batchRequests = sortedSmallAspects.map((aspectData) => {
            const prompt = buildAspectSectionPrompt(aspectData, userContext);
            return {
              customId: `persona-section-${aspectData.aspect}-${Date.now()}`,
              messages: [prompt],
              systemPrompt: "",
            };
          });

          logger.info(
            `Generating ${batchRequests.length} small persona sections in batch`,
            {
              aspects: sortedSmallAspects.map((a) => a.aspect),
            },
          );

          const { batchId } = await createBatch({
            requests: batchRequests,
            outputSchema: SectionContentSchema,
            maxRetries: 3,
            timeoutMs: 1200000,
          });

          const batch = await pollBatchCompletion(batchId, 1200000);

          if (batch.results && batch.results.length > 0) {
            for (let i = 0; i < batch.results.length; i++) {
              const result = batch.results[i];
              const aspectData = sortedSmallAspects[i];
              const sectionInfo = ASPECT_SECTION_MAP[aspectData.aspect];

              if (result.error || !result.response) {
                logger.warn(`Error generating ${aspectData.aspect} section`, {
                  error: result.error,
                });
                continue;
              }

              const content =
                typeof result.response === "string"
                  ? result.response
                  : result.response.content || "";

              if (content.includes("INSUFFICIENT_DATA")) {
                logger.info(
                  `${aspectData.aspect} section returned INSUFFICIENT_DATA`,
                );
                continue;
              }

              results.push({
                aspect: aspectData.aspect,
                title: sectionInfo.title,
                content,
                statementCount: aspectData.statements.length,
                episodeCount: aspectData.episodes.length,
              });
            }
          }
        } else {
          logger.info(
            `Generating ${sortedSmallAspects.length} small persona sections directly`,
            { aspects: sortedSmallAspects.map((a) => a.aspect) },
          );

          const directResults = await Promise.all(
            sortedSmallAspects.map((aspectData) =>
              directLLMCall(buildAspectSectionPrompt(aspectData, userContext)),
            ),
          );

          for (let i = 0; i < directResults.length; i++) {
            const content = directResults[i];
            const aspectData = sortedSmallAspects[i];
            const sectionInfo = ASPECT_SECTION_MAP[aspectData.aspect];
            if (!content) {
              logger.warn(`Empty result generating ${aspectData.aspect} section`);
              continue;
            }
            if (content.includes("INSUFFICIENT_DATA")) {
              logger.info(
                `${aspectData.aspect} section returned INSUFFICIENT_DATA`,
              );
              continue;
            }
            results.push({
              aspect: aspectData.aspect,
              title: sectionInfo.title,
              content,
              statementCount: aspectData.statements.length,
              episodeCount: aspectData.episodes.length,
            });
          }
        }

        return results;
      })(),
    );
  }

  // Wait for all tasks to complete in parallel
  const allResults = await Promise.all(parallelTasks);
  for (const result of allResults) {
    sections.push(...result);
  }

  return sections;
}

/**
 * Combine sections into final persona document
 */
function combineIntoPersonaDocument(
  sections: PersonaSectionResult[],
  userContext: UserContext,
): string {
  const sectionOrder: StatementAspect[] = [
    "Identity",
    "Preference",
    "Directive",
  ];

  const sectionsByAspect = new Map(sections.map((s) => [s.aspect, s]));

  // Build document
  let document = "# PERSONA\n\n";

  // Add each section with markers — always emit all 3, even if empty
  for (const aspect of sectionOrder) {
    const section = sectionsByAspect.get(aspect);
    const title = ASPECT_SECTION_MAP[aspect].title;
    document += `## ${title}\n\n`;
    if (section) {
      document += `${sanitizeSectionContent(section.content)}\n\n`;
    }
  }

  return document.trim();
}

/**
 * Poll batch until completion
 */
async function pollBatchCompletion(batchId: string, maxPollingTime: number) {
  const pollInterval = 3000;
  const startTime = Date.now();

  let batch = await getBatch({ batchId });

  while (batch.status === "processing" || batch.status === "pending") {
    const elapsed = Date.now() - startTime;

    if (elapsed > maxPollingTime) {
      throw new Error(`Batch timed out after ${elapsed}ms`);
    }

    logger.debug(`Batch status: ${batch.status}`, {
      batchId,
      completed: batch.completedRequests,
      total: batch.totalRequests,
      elapsed,
    });

    await new Promise((resolve) => setTimeout(resolve, pollInterval));
    batch = await getBatch({ batchId });
  }

  if (batch.status === "failed") {
    throw new Error(`Batch failed: ${batchId}`);
  }

  return batch;
}

/**
 * Main entry point for aspect-based persona generation (full mode)
 */
export async function generateAspectBasedPersona(
  userId: string,
): Promise<string> {
  logger.info("Starting aspect-based persona generation", { userId });

  // Step 1: Get user context
  const userContext = await getUserContext(userId);
  logger.info("User context retrieved", {
    source: userContext.source,
    hasRole: !!userContext.role,
  });

  // Step 2: Fetch statements grouped by aspect with episodes
  const aspectDataMap = await getStatementsByAspectWithEpisodes(userId);
  logger.info("Fetched statements by aspect", {
    aspectCount: aspectDataMap.size,
    aspects: Array.from(aspectDataMap.keys()),
    statementCounts: Object.fromEntries(
      Array.from(aspectDataMap.entries()).map(([k, v]) => [
        k,
        v.statements.length,
      ]),
    ),
  });

  // Step 2b: Inject user table fields as synthetic Identity statements (full mode only)
  const syntheticIdentityFacts: string[] = [];
  if (userContext.name)
    syntheticIdentityFacts.push(`Name: ${userContext.name}`);
  if (userContext.email)
    syntheticIdentityFacts.push(`Email: ${userContext.email}`);
  if (userContext.phoneNumber)
    syntheticIdentityFacts.push(`Phone: ${userContext.phoneNumber}`);
  if (userContext.timezone)
    syntheticIdentityFacts.push(`Timezone: ${userContext.timezone}`);
  if (userContext.role)
    syntheticIdentityFacts.push(`Role: ${userContext.role}`);

  if (syntheticIdentityFacts.length > 0) {
    const existingIdentity = aspectDataMap.get("Identity");
    const now = new Date();

    const newStatements: StatementNode[] = syntheticIdentityFacts
      .filter(
        (fact) => !existingIdentity?.statements.some((s) => s.fact === fact),
      )
      .map((fact) => ({
        uuid: `user-ctx-${fact.split(":")[0].toLowerCase()}`,
        fact,
        factEmbedding: [],
        createdAt: now,
        validAt: now,
        invalidAt: null,
        attributes: {},
        userId,
        aspect: "Identity" as StatementAspect,
      }));

    if (newStatements.length > 0) {
      if (existingIdentity) {
        existingIdentity.statements.push(...newStatements);
      } else {
        aspectDataMap.set("Identity", {
          aspect: "Identity",
          statements: newStatements,
          episodes: [],
        });
      }
      logger.info(
        `Injected ${newStatements.length} user context facts into Identity`,
      );
    }
  }

  if (aspectDataMap.size === 0) {
    logger.warn("No statements with aspects found for user", { userId });
    return "# PERSONA\n\nInsufficient data to generate persona. Continue using the system to build your knowledge graph.";
  }

  // Step 3: Generate all sections
  const sections = await generateAllAspectSections(aspectDataMap, userContext);
  logger.info("Generated persona sections", {
    sectionCount: sections.length,
    sections: sections.map((s) => s.title),
  });

  if (sections.length === 0) {
    return "# PERSONA\n\nInsufficient data in each aspect to generate meaningful persona sections. Continue using the system to build your knowledge graph.";
  }

  // Step 4: Combine into final document
  const personaDocument = combineIntoPersonaDocument(sections, userContext);
  logger.info("Persona document generated", {
    length: personaDocument.length,
    sectionCount: sections.length,
  });

  return personaDocument;
}
