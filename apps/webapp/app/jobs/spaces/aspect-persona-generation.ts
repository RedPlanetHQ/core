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
import { z } from "zod";
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

import { createAgent, resolveModelString } from "~/lib/model.server";
import { type ModelMessage } from "ai";
import { type MessageListInput } from "@mastra/core/agent/message-list";

/**
 * Direct LLM call helper — replaces batch for single/few requests.
 * Returns the text content from a single prompt.
 */
async function directLLMCall(
  prompt: MessageListInput,
  label?: string,
): Promise<string | null> {
  try {
    const modelId = await resolveModelString("chat", "medium");
    const agent = createAgent(modelId);
    const result = await agent.generate(prompt);
    const text = result.text;
    logger.info(`Direct LLM call completed${label ? ` [${label}]` : ""}`, {
      responseLength: text.length,
      preview: text.slice(0, 100),
    });
    return text;
  } catch (error) {
    logger.error(`Direct LLM call failed${label ? ` [${label}]` : ""}`, {
      error,
    });
    return null;
  }
}

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
 * Lighter sanitizer for existing section bodies fed back into the LLM prompt
 * or into `applyDelta`. Only strips legacy `<!-- section:X -->` round-trip
 * markers — never touches headings or blank lines, since the user may have
 * added structure inside the section.
 */
function stripLegacySectionMarkers(content: string): string {
  return content.replace(/<!-- section:\w+ -->/g, "").trim();
}

/**
 * Minimum Jaccard similarity required between an existing section and the
 * post-delta merged section. Below this threshold the delta is rejected and
 * the existing section is kept verbatim — guards against the LLM rewriting
 * the whole section instead of applying a small patch.
 *
 * 0.5 means at least half the word-tokens must overlap. Tune if needed.
 */
const INCREMENTAL_JACCARD_THRESHOLD = 0.5;

/**
 * Word-level Jaccard similarity between two strings.
 * Returns 1.0 if both are empty, 0.0 if one is empty and the other isn't.
 */
function jaccardSimilarity(a: string, b: string): number {
  const tokenize = (s: string) =>
    new Set(s.toLowerCase().match(/\b\w+\b/g) ?? []);
  const setA = tokenize(a);
  const setB = tokenize(b);
  if (setA.size === 0 && setB.size === 0) return 1.0;
  if (setA.size === 0 || setB.size === 0) return 0.0;
  let intersection = 0;
  for (const token of setA) {
    if (setB.has(token)) intersection++;
  }
  const union = setA.size + setB.size - intersection;
  return intersection / union;
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
    filterGuidance:
      "Include: name, profession, role, affiliations, email, phone, location, timezone. Exclude: health metrics, body composition, detailed physical stats - those belong in memory, not persona.",
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
    filterGuidance:
      "Include: communication style, formatting preferences, tool choices, workflow preferences, tone preferences. These are 'I prefer X' statements. Exclude: hard rules (those are Directives), one-time requests, and project-specific preferences.",
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
    filterGuidance:
      "Include: all standing instructions, hard constraints, automation rules, and active decisions that should not be re-litigated. These are non-negotiable. Format as actionable rules: 'Always...', 'Never...', 'Use X for Y'.",
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

// Zod schema for incremental delta output — LLM returns only what to add/replace
const IncrementalDeltaSchema = z.object({
  add: z.array(
    z.object({
      bullet: z.string(),
      group: z.string().optional(),
    }),
  ),
  replace: z.array(
    z.object({
      old: z.string(),
      new: z.string(),
    }),
  ),
});

export type IncrementalDelta = z.infer<typeof IncrementalDeltaSchema>;

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

  // Preferences section can be more detailed; others should be ultra-concise
  const isPreferencesSection = aspect === "Preference";

  const content = `
You are generating the **${sectionInfo.title}** section of a persona document.

## What is a Persona Document?

A persona is NOT a summary of everything known about a person. It is an **operating manual** for AI agents to interact with this person effectively.

**Core principle:** Every line must change how an agent behaves. If removing a line wouldn't change agent behavior, delete it.

Think of it as a quick reference card, not a biography or database dump.

## Why This Section Exists

The **${sectionInfo.title}** section answers: "${sectionInfo.agentQuestion}"

${sectionInfo.description}

## User Context
${userContext.name ? `- Name: ${userContext.name}` : ""}
${userContext.role ? `- Role: ${userContext.role}` : ""}
${userContext.goal ? `- Goal: ${userContext.goal}` : ""}

## Raw Facts (${statements.length} statements)
${factsText}

## Source Episodes (for context)
${episodesText}

## Filtering Rules

${sectionInfo.filterGuidance}

## Output Requirements

${
  isPreferencesSection
    ? `
**PREFERENCES can be detailed** - Style rules, communication preferences, and formatting requirements need specificity to be useful.

- Include specific style preferences (e.g., "prefers lowercase month abbreviations: jan, feb, mar")
- Group related preferences under sub-headers
- Be precise - vague preferences are useless
- Max 20 words per bullet point
- These are "I prefer" / "I like" statements, NOT hard rules (those go in DIRECTIVES)
`
    : `
**BE ULTRA-CONCISE** - This is not the Preferences section.

- Maximum 10 words per bullet point
- Maximum 5-7 bullet points total for the section
- Merge related facts aggressively
- No explanatory text - just the rule/fact
- If you can say it in fewer words, do it
`
}

## What to Include vs Exclude

✅ INCLUDE:
- Facts that change how an agent should behave in EVERY interaction
- Ongoing/current state (not historical)
- General principles (not one-time or project-specific)

❌ EXCLUDE:
- Anything an agent can get from memory search at runtime
- Completed/past items
- Project-specific or temporary context
- Detailed health data, specific events, relationship details
- Skills/expertise (agent doesn't need to know what you know)

## Format

- Markdown bullet points
- Sub-headers only if genuinely needed for grouping
- End with [Confidence: HIGH|MEDIUM|LOW]
- Even if there is only 1 fact, generate the section — do NOT return "INSUFFICIENT_DATA"

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

## Section Purpose
${sectionInfo.agentQuestion}

## Facts in this chunk (${chunk.statements.length} statements)
${factsText}

## Source Episodes (for context)
${episodesText}

## Instructions

Summarize the key patterns from this chunk that would help an AI agent understand this person.

- Extract only patterns that change how an agent should behave
- Be concise: max 10 words per bullet point
- Focus on facts, not descriptions
- Return bullet points only, no headers
- If no meaningful patterns exist, return "NO_PATTERNS"

Output bullet points only.
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
  const isPreferencesSection = aspect === "Preference";

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

## What is a Persona Document?

A persona is an **operating manual** for AI agents. Every line must change how an agent behaves.

## Section Purpose
The **${sectionInfo.title}** section answers: "${sectionInfo.agentQuestion}"

## Chunk Summaries (ordered by recency)

${summariesText}

## Merge Rules

1. **Recent info takes precedence** - If there's a conflict, the most recent chunk wins
2. **Deduplicate** - Remove redundant information across chunks
3. **Preserve important older info** - Older patterns are still valid unless contradicted
4. **Be concise** - The final output should be shorter than the sum of chunks

${
  isPreferencesSection
    ? `
## Output Format (PREFERENCES)
- Detailed rules are OK (max 20 words per bullet)
- Group related preferences under sub-headers
- Be specific - vague preferences are useless
`
    : `
## Output Format (NON-PREFERENCES)
- Maximum 10 words per bullet point
- Maximum 5-7 bullet points total
- No sub-headers unless absolutely necessary
`
}

End with [Confidence: HIGH|MEDIUM|LOW]

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

  // Generate summary for each chunk via batch
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

  // Collect chunk summaries
  const chunkSummaries: string[] = [];
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

  if (chunkSummaries.length === 0) {
    logger.info(`No patterns found in any chunk for ${aspect}`);
    return "INSUFFICIENT_DATA";
  }

  // If only one chunk had content, use it directly
  if (chunkSummaries.length === 1) {
    return chunkSummaries[0];
  }

  // Merge chunk summaries via batch
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
    return chunkSummaries[0]; // Fallback to first chunk
  }

  const mergeResult = mergeBatch.results[0];
  if (mergeResult.error || !mergeResult.response) {
    return chunkSummaries[0]; // Fallback
  }

  return typeof mergeResult.response === "string"
    ? mergeResult.response
    : mergeResult.response.content || chunkSummaries[0];
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
        const results: PersonaSectionResult[] = [];

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
 * Fetch statements for a specific episode, grouped by aspect
 * Used for incremental persona generation — only gets statements from one episode.
 * Also fetches voice aspects linked to this episode from the Aspects Store.
 */
export async function getStatementsForEpisodeByAspect(
  userId: string,
  episodeUuid: string,
): Promise<Map<StatementAspect, AspectData>> {
  const graphProvider = ProviderFactory.getGraphProvider();

  const query = `
    MATCH (e:Episode {uuid: $episodeUuid})-[:HAS_PROVENANCE]->(s:Statement {userId: $userId})
    WHERE s.invalidAt IS NULL
      AND s.aspect IS NOT NULL
      AND s.aspect IN $personaAspects
    RETURN s.aspect AS aspect,
           collect(DISTINCT {
             uuid: s.uuid,
             fact: s.fact,
             createdAt: s.createdAt,
             validAt: s.validAt,
             attributes: s.attributes,
             aspect: s.aspect
           }) AS statements
    ORDER BY aspect
  `;

  const voiceAspectSet = new Set<string>(VOICE_ASPECTS);

  // Fetch graph statements and episode's voice aspects in parallel
  const [results, episodeVoiceAspects] = await Promise.all([
    graphProvider.runQuery(query, {
      userId,
      episodeUuid,
      personaAspects: ["Identity", "Preference", "Directive"],
    }),
    // getVoiceAspectsForEpisode returns voice aspects linked to this episode
    import("~/services/aspectStore.server").then((m) =>
      m.getVoiceAspectsForEpisode(episodeUuid, userId),
    ),
  ]);

  const aspectDataMap = new Map<StatementAspect, AspectData>();

  for (const record of results) {
    const aspect = record.get("aspect") as StatementAspect;
    const rawStatements = record.get("statements") as any[];

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

    // Episodes not needed for incremental — we already have the existing persona doc
    aspectDataMap.set(aspect, { aspect, statements, episodes: [] });
  }

  // Merge voice aspects from this episode into persona-relevant aspects
  for (const va of episodeVoiceAspects) {
    if (!voiceAspectSet.has(va.aspect)) continue;

    // Only merge Preference and Directive (persona-relevant voice aspects)
    const aspect = va.aspect as StatementAspect;
    if (aspect !== "Preference" && aspect !== "Directive") continue;

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

  return aspectDataMap;
}

/**
 * Build prompt for incremental delta update of a SINGLE section.
 * The LLM returns a JSON delta ({ add: [...], replace: [...] }) — NOT a rewritten section.
 * Code applies the delta to the existing section text via applyDelta().
 */
function buildDeltaPrompt(
  aspect: StatementAspect,
  existingSectionContent: string,
  newStatements: StatementNode[],
  userContext: UserContext,
  hasUserEdits: boolean,
): MessageListInput {
  const sectionInfo = ASPECT_SECTION_MAP[aspect];
  const isPreferencesSection = aspect === "Preference";

  const factsText = newStatements
    .map((s, i) => `${i + 1}. ${s.fact}`)
    .join("\n");

  const userEditsBanner = hasUserEdits
    ? `\n## ⚠ User has manually edited this section\n\nThe existing content below contains the user's own wording. Treat every existing line as authoritative. **Output an empty \`replace\` array** — never modify or reword existing bullets. New facts must go in \`add\` only; if a new fact appears to conflict with an existing line, still ADD it as a separate bullet and let the user reconcile.\n`
    : "";

  const content = `
You are updating the **${sectionInfo.title}** section of a persona document. A few new facts were learned. Your job is to produce a JSON delta describing ONLY what to add or replace — you must NOT rewrite the section.
${userEditsBanner}

## Existing Section Content (READ-ONLY — do not reproduce this)

${existingSectionContent}

## New Facts to Incorporate

${factsText}

## Section Rules

${sectionInfo.filterGuidance}

## Instructions

Analyze the new facts against the existing section content and produce a JSON object with two arrays:

1. **add** — New bullets to insert. Each entry: \`{ "bullet": "text", "group": "Sub-Header Name" }\`.
   - \`group\` is optional. ${isPreferencesSection ? 'For the Preferences section, set `group` to the name of the sub-header (e.g., "Communication Style") where this bullet belongs. If no matching sub-header exists, omit `group` and it will be appended at the end.' : "Omit `group` for this section."}
   - Do NOT include the leading "- " in the bullet text — it will be added automatically.

2. **replace** — Bullets that directly contradict an existing entry. Each entry: \`{ "old": "existing bullet text", "new": "replacement text" }\`.
   - \`old\` should match the existing bullet text (without the leading "- ").
   - \`new\` is the replacement text (without the leading "- ").
   - **Be conservative**: only replace when a new fact DIRECTLY contradicts an existing entry with HIGH confidence (e.g., role changed, location changed). When uncertain, ADD as a new bullet instead.

## CRITICAL Rules

- Output ONLY a JSON object: \`{ "add": [...], "replace": [...] }\`
- Both arrays may be empty if no changes are needed
- NEVER rephrase, reorder, or summarize existing bullets
- NEVER include bullets that already exist in the section
- When in doubt, ADD rather than REPLACE
- Do NOT wrap in markdown code fences — output raw JSON only

## Example Output

{ "add": [{ "bullet": "Prefers dark mode in all applications" }], "replace": [{ "old": "Works as a frontend developer", "new": "Works as a senior frontend developer" }] }
  `.trim();

  return { role: "user", content };
}

/**
 * Normalize a bullet string for fuzzy matching:
 * strip leading bullet markers (- , * , • ), trim whitespace.
 */
function normalizeBullet(text: string): string {
  return text.replace(/^[\s]*[-*•]\s*/, "").trim();
}

/**
 * Apply a validated delta to existing section text.
 * Pure function — no IO, highly testable.
 *
 * 1. Replacements first: find matching bullet via fuzzy match, swap in-place.
 *    If no match found, log warning and skip (no corruption).
 * 2. Additions second: insert at end of named group (sub-header) if `group` specified,
 *    otherwise insert before the [Confidence: ...] line or at end.
 *
 * `skipReplacements`: drop the entire replace pass. Use when the persona has
 * been edited by the user since the last system generation — the LLM cannot
 * tell user-edited bullets from previously system-generated ones, so any
 * `replace` it emits risks silently overwriting user intent. Adds still apply,
 * letting new facts accumulate as additional bullets the user can curate.
 */
export interface ApplyDeltaOptions {
  skipReplacements?: boolean;
}

export function applyDelta(
  existingSection: string,
  delta: IncrementalDelta,
  opts: ApplyDeltaOptions = {},
): string {
  const lines = existingSection.split("\n");

  // --- Replacements ---
  if (!opts.skipReplacements) {
    for (const rep of delta.replace) {
      const normalizedOld = normalizeBullet(rep.old);
      if (!normalizedOld) continue;

      let matched = false;
      for (let i = 0; i < lines.length; i++) {
        const normalizedLine = normalizeBullet(lines[i]);
        if (normalizedLine && normalizedLine === normalizedOld) {
          // Preserve the original bullet prefix (e.g., "- ", "* ")
          const prefixMatch = lines[i].match(/^([\s]*[-*•]\s*)/);
          const prefix = prefixMatch ? prefixMatch[1] : "- ";
          lines[i] = `${prefix}${rep.new}`;
          matched = true;
          break;
        }
      }
      if (!matched) {
        logger.warn("applyDelta: replacement old text not found, skipping", {
          old: rep.old,
        });
      }
    }
  } else if (delta.replace.length > 0) {
    logger.info(
      "applyDelta: skipping replace ops because persona has user edits",
      { skippedReplacements: delta.replace.length },
    );
  }

  // --- Additions ---
  for (const add of delta.add) {
    const bulletLine = `- ${add.bullet}`;

    if (add.group) {
      // Find the sub-header matching the group name
      const groupHeaderIdx = lines.findIndex((line) => {
        const trimmed = line.trim();
        return (
          trimmed.startsWith("### ") &&
          trimmed.slice(4).trim().toLowerCase() === add.group!.toLowerCase()
        );
      });

      if (groupHeaderIdx !== -1) {
        // Find the last bullet under this group (before next header or end)
        let insertIdx = groupHeaderIdx + 1;
        for (let i = groupHeaderIdx + 1; i < lines.length; i++) {
          const trimmed = lines[i].trim();
          if (trimmed.startsWith("## ") || trimmed.startsWith("### ")) break;
          if (trimmed.startsWith("[Confidence:")) break;
          if (trimmed.startsWith("- ") || trimmed.startsWith("* ")) {
            insertIdx = i + 1;
          }
        }
        lines.splice(insertIdx, 0, bulletLine);
        continue;
      }
      // Group not found — fall through to default insertion
    }

    // Default: insert before [Confidence: ...] line, or at end
    const confidenceIdx = lines.findIndex((line) =>
      line.trim().startsWith("[Confidence:"),
    );
    if (confidenceIdx !== -1) {
      lines.splice(confidenceIdx, 0, bulletLine);
    } else {
      lines.push(bulletLine);
    }
  }

  return lines.join("\n");
}

/**
 * Generate an incremental persona update using section-level merging.
 *
 * Uses the same pattern as task pages: split by ## headings, update only
 * affected sections, preserve everything else verbatim. Unknown sections
 * and user-added content are never dropped.
 */
export async function generateIncrementalPersona(
  userId: string,
  episodeUuid: string,
  existingPersonaContent: string,
  hasUserEdits: boolean = false,
): Promise<string> {
  logger.info("Starting incremental persona generation", {
    userId,
    episodeUuid,
    hasUserEdits,
  });

  // Step 1: Get user context
  const userContext = await getUserContext(userId);

  // Step 2: Get this episode's persona-relevant statements
  const episodeStatements = await getStatementsForEpisodeByAspect(
    userId,
    episodeUuid,
  );

  if (episodeStatements.size === 0) {
    logger.info(
      "No persona-relevant statements in episode, returning existing persona",
      {
        userId,
        episodeUuid,
      },
    );
    return existingPersonaContent;
  }

  const totalStatements = Array.from(episodeStatements.values()).reduce(
    (sum, d) => sum + d.statements.length,
    0,
  );

  const affectedAspects = Array.from(episodeStatements.keys());

  logger.info("Episode persona statements fetched", {
    userId,
    episodeUuid,
    aspects: affectedAspects,
    totalStatements,
  });

  // Step 3: Split existing document into sections by ## headings
  const existingSections = splitByH2Markdown(existingPersonaContent);

  logger.info("Split existing persona document", {
    userId,
    sectionCount: existingSections.length,
    headings: existingSections.map((s) => s.heading),
    existingDocLength: existingPersonaContent.length,
  });

  // Step 4: For each affected aspect, build delta prompt and apply
  // Each section is updated independently — other sections untouched.
  const sectionUpdates: {
    aspect: StatementAspect;
    sectionTitle: string;
    prompt: MessageListInput;
    existingBody: string;
  }[] = [];

  for (const [aspect, data] of episodeStatements) {
    const sectionTitle = ASPECT_SECTION_MAP[aspect].title;

    // Find existing section by heading (case-insensitive)
    const existingSection = existingSections.find(
      (s) => s.heading?.toUpperCase() === sectionTitle,
    );

    // Extract just the body (content after the ## heading line). Only strip
    // legacy round-trip markers — keep user-added headings/whitespace intact.
    const existingBody = existingSection
      ? stripLegacySectionMarkers(getSectionBody(existingSection.content))
      : "";

    // Check for pinned sections
    if (existingSection?.content.includes("<!-- pinned -->")) {
      logger.info(`Skipping pinned section during incremental generation`, {
        userId,
        episodeUuid,
        aspect,
      });
      continue;
    }

    const prompt = buildDeltaPrompt(
      aspect,
      existingBody || `(No existing content)`,
      data.statements,
      userContext,
      hasUserEdits,
    );

    sectionUpdates.push({ aspect, sectionTitle, prompt, existingBody });
  }

  // Step 5: Direct LLM calls in parallel, parse JSON delta, apply to section
  const updateResults = await Promise.all(
    sectionUpdates.map(async ({ aspect, sectionTitle, prompt, existingBody }) => {
      const rawResponse = await directLLMCall(
        prompt,
        `incremental-delta-${aspect}`,
      );

      if (!rawResponse) {
        logger.warn(
          `LLM call failed for ${aspect} delta, keeping existing section`,
        );
        return { sectionTitle, newBody: null };
      }

      // Parse JSON and validate with Zod
      try {
        const parsedJson = JSON.parse(rawResponse);
        const delta = IncrementalDeltaSchema.parse(parsedJson);

        const mergedBody = applyDelta(existingBody, delta, {
          skipReplacements: hasUserEdits,
        });

        // Jaccard check: reject if merged section diverges too much from existing.
        if (existingBody.trim().length > 0) {
          const similarity = jaccardSimilarity(existingBody, mergedBody);
          if (similarity < INCREMENTAL_JACCARD_THRESHOLD) {
            logger.warn(
              `Jaccard similarity too low for ${aspect} — rejecting delta, keeping existing section`,
              {
                similarity,
                threshold: INCREMENTAL_JACCARD_THRESHOLD,
                adds: delta.add.length,
                replacements: delta.replace.length,
              },
            );
            return { sectionTitle, newBody: null };
          }
        }

        logger.info(`Delta applied for ${aspect}`, {
          adds: delta.add.length,
          replacements: delta.replace.length,
        });

        return { sectionTitle, newBody: sanitizeSectionContent(mergedBody) };
      } catch (error) {
        logger.warn(
          `Failed to parse/validate delta for ${aspect}, keeping existing section`,
          {
            error:
              error instanceof Error ? error.message : String(error),
            rawResponsePreview: rawResponse.slice(0, 200),
          },
        );
        return { sectionTitle, newBody: null };
      }
    }),
  );

  // Step 6: Merge each updated section into the document — one at a time.
  // mergeSectionIntoMarkdown preserves all other sections verbatim.
  let updatedPersona = existingPersonaContent;

  for (const { sectionTitle, newBody } of updateResults) {
    if (newBody !== null) {
      updatedPersona = mergeSectionIntoMarkdown(
        updatedPersona,
        sectionTitle,
        newBody,
      );
    }
  }

  logger.info("Incremental persona generation completed", {
    userId,
    episodeUuid,
    affectedSections: affectedAspects,
    originalLength: existingPersonaContent.length,
    updatedLength: updatedPersona.length,
  });

  return updatedPersona;
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
