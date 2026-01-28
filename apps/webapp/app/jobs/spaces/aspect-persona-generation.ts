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
import { StatementAspects, type StatementAspect, type StatementNode, type EpisodicNode } from "@core/types";
import { ProviderFactory } from "@core/providers";
import { type ModelMessage } from "ai";

// Minimum statements required to generate a section
const MIN_STATEMENTS_PER_SECTION = 3;

// Chunking limits for large sections
const MAX_STATEMENTS_PER_CHUNK = 30;
const MAX_EPISODES_PER_CHUNK = 20;

// Aspects to skip entirely from persona generation
// Event: Transient calendar/schedule data - agents can query graph directly for specific dates
const SKIPPED_ASPECTS: StatementAspect[] = ["Event", "Relationship"];

// Aspect to persona section mapping with filtering guidance
// Each section answers a specific question an AI agent might have
export const ASPECT_SECTION_MAP: Record<StatementAspect, {
  title: string;
  description: string;
  agentQuestion: string;
  filterGuidance: string;
}> = {
  Identity: {
    title: "IDENTITY",
    description: "Who they are - name, role, contact info, location, physical stats",
    agentQuestion: "Who am I talking to? How do I reach them?",
    filterGuidance: "Include: name, profession, role, email, phone, location, timezone, physical stats (height, weight, body composition). Any agent might need these identifiers.",
  },
  Knowledge: {
    title: "EXPERTISE",
    description: "What they know - skills, technologies, domains, tools",
    agentQuestion: "What do they know? (So I calibrate complexity)",
    filterGuidance: "Include: all technical skills, domain expertise, tools, platforms, frameworks they work with. Any agent might need to know their capability level.",
  },
  Belief: {
    title: "WORLDVIEW",
    description: "Core values, opinions, principles they hold",
    agentQuestion: "What do they believe? (So I align with their values)",
    filterGuidance: "Include: core values, strong opinions, guiding principles, philosophies. These shape how agents should frame suggestions.",
  },
  Preference: {
    title: "PREFERENCES",
    description: "Communication style, formats, how they want things done",
    agentQuestion: "How do they want things? (Style, format, approach)",
    filterGuidance: "Include: all communication preferences, formatting rules, style choices, tool preferences. Be specific - vague preferences are useless to agents.",
  },
  Action: {
    title: "BEHAVIORS",
    description: "Regular habits, workflows, routines - work and personal",
    agentQuestion: "What do they do regularly? (So I fit into their life)",
    filterGuidance: "Include: recurring habits, established workflows, routines (work, health, personal). Exclude: one-time completed actions.",
  },
  Goal: {
    title: "GOALS",
    description: "What they're trying to achieve - work, health, personal",
    agentQuestion: "What are they trying to achieve? (So I align suggestions)",
    filterGuidance: "Include: all ongoing objectives across work, health, personal life. Exclude: completed goals, past deliverables.",
  },
  Directive: {
    title: "DIRECTIVES",
    description: "Standing rules - always do X, never do Y, notify when Z",
    agentQuestion: "What rules must I follow?",
    filterGuidance: "Include: all standing instructions, hard constraints, automation rules. These are non-negotiable for agents.",
  },
  Decision: {
    title: "DECISIONS",
    description: "Choices already made - don't re-litigate these",
    agentQuestion: "What's already decided? (Don't suggest alternatives)",
    filterGuidance: "Include: all active decisions (technology, architecture, strategy, lifestyle). Agents should not suggest alternatives to decided matters.",
  },
  Event: {
    title: "TIMELINE",
    description: "Key events and milestones",
    agentQuestion: "What happened when?",
    filterGuidance: "SKIP - Transient data. Agents should query the graph directly for date-specific information.",
  },
  Problem: {
    title: "CHALLENGES",
    description: "Current blockers, struggles, areas needing attention",
    agentQuestion: "What's blocking them? (Where can I help?)",
    filterGuidance: "Include: all ongoing challenges, pain points, blockers. Exclude: resolved issues.",
  },
  Relationship: {
    title: "RELATIONSHIPS",
    description: "Key people - names, roles, contact info, how to work with them",
    agentQuestion: "Who matters to them? (Context for names mentioned)",
    filterGuidance: "Include: names, roles, relationships, contact info (email, phone), collaboration notes. Any agent might need to reference or contact these people.",
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
 * Fetch statements grouped by aspect with their provenance episodes
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

  const results = await graphProvider.runQuery(query, { userId });

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
      attributes: typeof s.attributes === "string" ? JSON.parse(s.attributes) : s.attributes || {},
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
  const factsText = statements
    .map((s, i) => `${i + 1}. ${s.fact}`)
    .join("\n");

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

${isPreferencesSection ? `
**PREFERENCES can be detailed** - Style rules, communication preferences, and formatting requirements need specificity to be useful.

- Include specific rules agents should follow (e.g., "lowercase month abbreviations: jan, feb, mar")
- Group related preferences under sub-headers
- Be precise - vague preferences are useless
- Max 20 words per bullet point
` : `
**BE ULTRA-CONCISE** - This is not the Preferences section.

- Maximum 10 words per bullet point
- Maximum 5-7 bullet points total for the section
- Merge related facts aggressively
- No explanatory text - just the rule/fact
- If you can say it in fewer words, do it
`}

## What to Include vs Exclude

✅ INCLUDE:
- Patterns that change how an agent should behave
- Ongoing/current state (not historical)
- General principles (not specific instances)

❌ EXCLUDE:
- Facts that don't affect agent behavior
- Completed/past items
- Specific dates, events, contact details
- Redundant information (don't repeat what's in other sections)

## Format

- Markdown bullet points
- Sub-headers only if genuinely needed for grouping
- End with [Confidence: HIGH|MEDIUM|LOW]
- Return "INSUFFICIENT_DATA" if fewer than 3 behavior-changing patterns exist

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
      const recencyLabel = i === 0 ? "MOST RECENT (highest priority)" : `Older chunk ${i + 1}`;
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

${isPreferencesSection ? `
## Output Format (PREFERENCES)
- Detailed rules are OK (max 20 words per bullet)
- Group related preferences under sub-headers
- Be specific - vague preferences are useless
` : `
## Output Format (NON-PREFERENCES)
- Maximum 10 words per bullet point
- Maximum 5-7 bullet points total
- No sub-headers unless absolutely necessary
`}

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
    (a, b) => b.createdAt.getTime() - a.createdAt.getTime()
  );
  const sortedEpisodes = [...episodes].sort(
    (a, b) => b.createdAt.getTime() - a.createdAt.getTime()
  );

  // Calculate number of chunks needed
  const numChunks = Math.max(
    Math.ceil(sortedStatements.length / MAX_STATEMENTS_PER_CHUNK),
    1
  );

  const chunks: ChunkData[] = [];

  for (let i = 0; i < numChunks; i++) {
    const stmtStart = i * MAX_STATEMENTS_PER_CHUNK;
    const stmtEnd = Math.min(stmtStart + MAX_STATEMENTS_PER_CHUNK, sortedStatements.length);

    const epStart = i * MAX_EPISODES_PER_CHUNK;
    const epEnd = Math.min(epStart + MAX_EPISODES_PER_CHUNK, sortedEpisodes.length);

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

  // Generate summary for each chunk
  const chunkRequests = chunks.map((chunk) => ({
    customId: `chunk-${aspect}-${chunk.chunkIndex}-${Date.now()}`,
    messages: [buildChunkSummaryPrompt(aspect, chunk, userContext)],
    systemPrompt: "",
  }));

  const { batchId: chunkBatchId } = await createBatch({
    requests: chunkRequests,
    outputSchema: SectionContentSchema,
    maxRetries: 3,
    timeoutMs: 180000,
  });

  const chunkBatch = await pollBatchCompletion(chunkBatchId, 180000);

  if (!chunkBatch.results || chunkBatch.results.length === 0) {
    logger.warn(`No chunk results for ${aspect}`);
    return null;
  }

  // Collect chunk summaries
  const chunkSummaries: string[] = [];
  for (const result of chunkBatch.results) {
    if (result.error || !result.response) continue;

    const content = typeof result.response === "string"
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

  // Merge chunk summaries
  const mergeRequest = {
    customId: `merge-${aspect}-${Date.now()}`,
    messages: [buildMergePrompt(aspect, chunkSummaries, userContext)],
    systemPrompt: "",
  };

  const { batchId: mergeBatchId } = await createBatch({
    requests: [mergeRequest],
    outputSchema: SectionContentSchema,
    maxRetries: 3,
    timeoutMs: 120000,
  });

  const mergeBatch = await pollBatchCompletion(mergeBatchId, 120000);

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
 * Generate a single aspect section
 */
async function generateAspectSection(
  aspectData: AspectData,
  userContext: UserContext,
): Promise<PersonaSectionResult | null> {
  const { aspect, statements, episodes } = aspectData;
  const sectionInfo = ASPECT_SECTION_MAP[aspect];

  // Skip if insufficient data
  if (statements.length < MIN_STATEMENTS_PER_SECTION) {
    logger.info(`Skipping ${aspect} section - insufficient data`, {
      statementCount: statements.length,
      minRequired: MIN_STATEMENTS_PER_SECTION,
    });
    return null;
  }

  const prompt = buildAspectSectionPrompt(aspectData, userContext);

  const batchRequest = {
    customId: `persona-section-${aspect}-${Date.now()}`,
    messages: [prompt],
    systemPrompt: "",
  };

  const { batchId } = await createBatch({
    requests: [batchRequest],
    outputSchema: SectionContentSchema,
    maxRetries: 3,
    timeoutMs: 120000,
  });

  // Poll for completion
  const batch = await pollBatchCompletion(batchId, 120000);

  if (!batch.results || batch.results.length === 0) {
    logger.warn(`No results for ${aspect} section`);
    return null;
  }

  const result = batch.results[0];
  if (result.error || !result.response) {
    logger.warn(`Error generating ${aspect} section`, { error: result.error });
    return null;
  }

  const content =
    typeof result.response === "string"
      ? result.response
      : result.response.content || "";

  // Check for insufficient data response
  if (content.includes("INSUFFICIENT_DATA")) {
    logger.info(`${aspect} section returned INSUFFICIENT_DATA`);
    return null;
  }

  return {
    aspect,
    title: sectionInfo.title,
    content,
    statementCount: statements.length,
    episodeCount: episodes.length,
  };
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
      logger.info(`Skipping ${aspect} - excluded from persona generation (transient data)`);
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
      logger.info(`Skipping ${aspect} - only ${data.statements.length} statements`);
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
    largeAspects: largeAspects.map((a) => `${a.aspect}(${a.statements.length})`),
  });

  // Process large sections with chunking (sequentially to avoid too many parallel batches)
  for (const aspectData of largeAspects) {
    const sectionInfo = ASPECT_SECTION_MAP[aspectData.aspect];

    const content = await generateSectionWithChunking(aspectData, userContext);

    if (content && !content.includes("INSUFFICIENT_DATA")) {
      sections.push({
        aspect: aspectData.aspect,
        title: sectionInfo.title,
        content,
        statementCount: aspectData.statements.length,
        episodeCount: aspectData.episodes.length,
      });
    }
  }

  // Process small sections in a single batch (existing logic)
  if (smallAspects.length > 0) {
    // Sort statements and episodes by recency for small sections too
    const sortedSmallAspects = smallAspects.map((aspectData) => ({
      ...aspectData,
      statements: [...aspectData.statements].sort(
        (a, b) => b.createdAt.getTime() - a.createdAt.getTime()
      ),
      episodes: [...aspectData.episodes].sort(
        (a, b) => b.createdAt.getTime() - a.createdAt.getTime()
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

    logger.info(`Generating ${batchRequests.length} small persona sections in batch`, {
      aspects: sortedSmallAspects.map((a) => a.aspect),
    });

    const { batchId } = await createBatch({
      requests: batchRequests,
      outputSchema: SectionContentSchema,
      maxRetries: 3,
      timeoutMs: 300000,
    });

    const batch = await pollBatchCompletion(batchId, 300000);

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
          logger.info(`${aspectData.aspect} section returned INSUFFICIENT_DATA`);
          continue;
        }

        sections.push({
          aspect: aspectData.aspect,
          title: sectionInfo.title,
          content,
          statementCount: aspectData.statements.length,
          episodeCount: aspectData.episodes.length,
        });
      }
    }
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
  // Sort sections by a logical order (Event, Relationship excluded - query graph when needed)
  const sectionOrder: StatementAspect[] = [
    "Identity",
    "Knowledge",
    "Belief",
    "Preference",
    "Action",
    "Goal",
    "Directive",
    "Decision",
    "Problem",
  ];

  const sortedSections = sections.sort((a, b) => {
    return sectionOrder.indexOf(a.aspect) - sectionOrder.indexOf(b.aspect);
  });

  // Build document
  let document = "# PERSONA\n\n";

  // Add metadata
  document += `> Generated: ${new Date().toISOString().split("T")[0]}\n`;
  document += `> Sections: ${sections.length}\n`;
  document += `> Total statements: ${sections.reduce((sum, s) => sum + s.statementCount, 0)}\n\n`;

  // Add each section
  for (const section of sortedSections) {
    document += `## ${section.title}\n\n`;
    document += `${section.content}\n\n`;
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
 * Main entry point for aspect-based persona generation
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
      Array.from(aspectDataMap.entries()).map(([k, v]) => [k, v.statements.length])
    ),
  });

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
