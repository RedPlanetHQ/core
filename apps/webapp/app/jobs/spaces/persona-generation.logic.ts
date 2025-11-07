import { exec } from "child_process";
import { promisify } from "util";
import { logger } from "~/services/logger.service";
import type { CoreMessage } from "ai";
import { createBatch, getBatch } from "~/lib/batch.server";
import { z } from "zod";
import { getUserContext, type UserContext } from "~/services/user-context.server";
import { assignEpisodesToSpace } from "~/services/graphModels/space";
import { getBertPythonPath } from "~/lib/bert-installer.server";
import type { EpisodicNode } from "@core/types";
import { SpaceService } from "~/services/space.server";
import { runQuery } from "~/lib/neo4j.server";
import { getEpisodesByUserId } from "~/services/graphModels/episode";
import { filterPersonaRelevantTopics } from "./persona-generation-filter";

const execAsync = promisify(exec);

// Payload for BullMQ worker
export interface PersonaGenerationPayload {
  userId: string;
  workspaceId: string;
  spaceId: string;
  mode: "full" | "incremental";
  startTime?: string;
}

export interface PersonaAnalytics {
  totalEpisodes: number;
  lexicon: Record<string, number>; // term -> frequency
  style: StyleMetrics;
  sources: Record<string, number>; // source -> percentage
  temporal: TemporalMetrics;
  receipts: string[]; // Explicit metrics/numbers found
}

export interface StyleMetrics {
  avgSentenceLength: number;
  avgParagraphLength: number;
  episodesWithBullets: number;
  episodesWithCode: number;
}

export interface TemporalMetrics {
  oldestEpisode: Date;
  newestEpisode: Date;
  timeSpanDays: number;
  episodesPerMonth: number;
}

export interface PersonaGenerationResult {
  success: boolean;
  spaceId: string;
  mode: string;
  summaryLength: number;
  episodesProcessed: number;
}

interface ClusteringOutput {
  topics: Record<
    string,
    {
      keywords: string[];
      episodeIds: string[];
    }
  >;
}

interface ClusterData {
  topicId: string;
  keywords: string[];
  episodeIds: string[];
}

// Zod schema for batch response validation
const PersonaSummarySchema = z.object({
  summary: z.string(),
});

/**
 * Generate persona summary from episodes using adaptive pipeline
 *
 * Pipeline stages:
 * 1. Get user context (onboarding → inferred → generic)
 * 2. Algorithmic analytics on ALL episodes (quantitative data)
 * 3. HDBSCAN clustering + intelligent filtering (persona-relevant topics only)
 * 4. Build adaptive prompt based on user context
 * 5. Generate via Batch API
 * 6. Assign episodes to space for traceability
 */
export async function generatePersonaSummary(
  episodes: EpisodicNode[],
  mode: "full" | "incremental",
  existingSummary: string | null,
  userId: string,
  spaceId: string,
  startTime?: string,
  clusteringRunner?: (userId: string, startTime?: string) => Promise<string>,
  analyticsRunner?: (userId: string, startTime?: string) => Promise<string>,
): Promise<string> {
  logger.info("Starting persona generation pipeline", {
    episodeCount: episodes.length,
    mode,
    hasExistingSummary: !!existingSummary,
    userId,
    spaceId,
    startTime,
  });

  // Stage 1: Get user context (onboarding → inferred → generic)
  const userContext = await getUserContext(userId);
  logger.info("User context retrieved", {
    source: userContext.source,
    hasRole: !!userContext.role,
    hasGoal: !!userContext.goal,
    toolsCount: userContext.tools?.length || 0,
  });

  // Stage 2: Python-based analytics extraction (TF-IDF, pattern analysis)
  const analytics = await extractPersonaAnalytics(userId, startTime, analyticsRunner);
  logger.info("Python analytics complete", {
    lexiconTerms: Object.keys(analytics.lexicon).length,
    avgSentenceLength: analytics.style.avgSentenceLength,
    timeSpanDays: analytics.temporal.timeSpanDays,
  });

  // Stage 3: Intelligent episode filtering via HDBSCAN clustering
  let filteredEpisodes = episodes;
  if (episodes.length > 50) {
    // Always run HDBSCAN clustering for larger datasets
    try {
      const clusters = await clusterEpisodes(userId, startTime, clusteringRunner);
      const personaClusters = await filterPersonaRelevantTopics(clusters, episodes);
      // Extract episode IDs from persona-relevant clusters
      const personaEpisodeIds = new Set<string>();
      for (const cluster of personaClusters) {
        cluster.episodeIds.forEach((id) => personaEpisodeIds.add(id));
      }

      filteredEpisodes = episodes.filter((e) => personaEpisodeIds.has(e.uuid));

      logger.info("HDBSCAN clustering filtering complete", {
        totalClusters: Object.keys(clusters.topics).length,
        personaClusters: personaClusters.length,
        originalEpisodes: episodes.length,
        filteredEpisodes: filteredEpisodes.length,
      });
    } catch (error) {
      logger.warn("HDBSCAN clustering failed, using all episodes", {
        error: error instanceof Error ? error.message : "Unknown error",
      });
      // Fall back to using all episodes if clustering fails
    }
  }

  // Stage 4: Generate persona using Batch API
  const summary =
    filteredEpisodes.length <= 50 || mode === "incremental"
      ? await generatePersonaSummarySingle(
          filteredEpisodes,
          mode,
          existingSummary,
          userContext,
          analytics
        )
      : await generatePersonaSummaryBatch(
          filteredEpisodes,
          mode,
          existingSummary,
          userContext,
          analytics
        );

  // Stage 5: Assign episodes to space for traceability
  if (filteredEpisodes.length > 0) {
    try {
      await assignEpisodesToSpace(
        filteredEpisodes.map((e) => e.uuid),
        spaceId,
        userId
      );
      logger.info("Episodes assigned to persona space", {
        episodeCount: filteredEpisodes.length,
        spaceId,
      });
    } catch (error) {
      logger.error("Failed to assign episodes to space", {
        error: error instanceof Error ? error.message : "Unknown error",
        spaceId,
      });
      // Don't fail the entire generation if assignment fails
    }
  }

  return summary;
}

/**
 * Run HDBSCAN clustering via Python script using exec (for BullMQ/Docker)
 */
async function runClusteringWithExec(
  userId: string,
  startTime?: string
): Promise<string> {
  let command = `python3 /core/apps/webapp/python/main.py ${userId} --json`;

  // Add time filter if provided
  if (startTime) {
    command += ` --start-time "${startTime}"`;
  }

  logger.info("Running HDBSCAN clustering with exec", { userId, startTime });

  const pythonPath = getBertPythonPath();

  const { stdout, stderr } = await execAsync(command, {
    timeout: 300000, // 5 minutes
    maxBuffer: 10 * 1024 * 1024, // 10MB buffer
    env: {
      ...process.env,
      PYTHONPATH: pythonPath,
    },
  });

  if (stderr) {
    logger.warn("HDBSCAN clustering warnings", { stderr });
  }

  return stdout;
}

/**
 * Run persona analytics via Python script using exec (for BullMQ/Docker)
 */
async function runAnalyticsWithExec(
  userId: string,
  startTime?: string
): Promise<string> {
  let command = `python3 /core/apps/webapp/python/persona_analytics.py ${userId} --json`;

  // Add time filter if provided
  if (startTime) {
    command += ` --start-time "${startTime}"`;
  }

  logger.info("Running persona analytics with exec", { userId, startTime });

  const pythonPath = getBertPythonPath();

  const { stdout, stderr } = await execAsync(command, {
    timeout: 300000, // 5 minutes
    maxBuffer: 10 * 1024 * 1024, // 10MB buffer
    env: {
      ...process.env,
      PYTHONPATH: pythonPath,
      NEO4J_URI: process.env.NEO4J_URI || "",
      NEO4J_USERNAME: process.env.NEO4J_USERNAME || "",
      NEO4J_PASSWORD: process.env.NEO4J_PASSWORD || "",
    },
  });

  if (stderr) {
    logger.warn("Persona analytics warnings", { stderr });
  }

  return stdout;
}

/**
 * Run HDBSCAN clustering via Python script
 * Accepts optional pythonRunner for Trigger.dev compatibility
 */
async function clusterEpisodes(
  userId: string,
  startTime?: string,
  pythonRunner?: (userId: string, startTime?: string) => Promise<string>
): Promise<ClusteringOutput> {
  logger.info("Running HDBSCAN clustering", { userId, startTime });

  // Use provided runner (Trigger.dev) or fallback to exec (BullMQ)
  const runner = pythonRunner || runClusteringWithExec;
  const stdout = await runner(userId, startTime);

  const rawOutput = JSON.parse(stdout);

  // Convert main.py format {clusterId: {...}} to expected format {topics: {topicId: {...}}}
  return { topics: rawOutput };
}

/**
 * Run persona analytics via Python script
 * Uses same pythonRunner as clustering but calls persona_analytics.py
 */
async function extractPersonaAnalytics(
  userId: string,
  startTime?: string,
  pythonRunner?: (userId: string, startTime?: string) => Promise<string>
): Promise<PersonaAnalytics> {
  logger.info("Running persona analytics", { userId, startTime });

  // Use provided runner (Trigger.dev) or fallback to exec (BullMQ)
  const runner = pythonRunner || runAnalyticsWithExec;
  const stdout = await runner(userId, startTime);

  const analytics = JSON.parse(stdout) as PersonaAnalytics;

  return analytics;
}

/**
 * Generate persona summary using single LLM call (for small datasets)
 */
async function generatePersonaSummarySingle(
  episodes: EpisodicNode[],
  mode: "full" | "incremental",
  existingSummary: string | null,
  userContext: UserContext,
  analytics: PersonaAnalytics
): Promise<string> {
  const prompt = buildAdaptivePersonaPrompt(
    episodes,
    mode,
    existingSummary,
    userContext,
    analytics
  );

  const batchRequest = {
    customId: `persona-summary-single-${Date.now()}`,
    messages: [prompt],
    systemPrompt: "",
  };

  const { batchId } = await createBatch({
    requests: [batchRequest],
    outputSchema: PersonaSummarySchema,
    maxRetries: 3,
    timeoutMs: 600000,
  });

  logger.info(`Persona summary batch created: ${batchId}`, {
    mode,
    episodeCount: episodes.length,
  });

  // Poll for completion
  const batch = await pollBatchCompletion(batchId, 600000);

  if (!batch.results || batch.results.length === 0) {
    throw new Error("No results returned from persona summary batch");
  }

  const result = batch.results[0];
  if (result.error || !result.response) {
    throw new Error(
      `Persona summary generation failed: ${result.error || "No response"}`
    );
  }

  const summary =
    typeof result.response === "string"
      ? result.response
      : result.response.summary || JSON.stringify(result.response);

  logger.info("Persona summary generated", {
    summaryLength: summary.length,
    mode,
  });

  return summary;
}

/**
 * Generate persona summary using batch API (for large datasets)
 */
async function generatePersonaSummaryBatch(
  episodes: EpisodicNode[],
  mode: "full" | "incremental",
  existingSummary: string | null,
  userContext: UserContext,
  analytics: PersonaAnalytics
): Promise<string> {
  const chunkSize = 50;
  const chunks: EpisodicNode[][] = [];

  for (let i = 0; i < episodes.length; i += chunkSize) {
    chunks.push(episodes.slice(i, i + chunkSize));
  }

  logger.info(`Creating ${chunks.length} batch requests for ${episodes.length} episodes`, {
    chunkSize,
    mode,
  });

  // Create batch requests for pattern extraction from each chunk
  const batchRequests = chunks.map((chunk, index) => {
    const prompt = buildPatternExtractionPrompt(chunk, userContext, analytics);
    return {
      customId: `persona-patterns-${mode}-${index}`,
      messages: [prompt],
      systemPrompt: "",
    };
  });

  const { batchId } = await createBatch({
    requests: batchRequests,
    maxRetries: 3,
    timeoutMs: 900000,
  });

  logger.info(`Persona pattern extraction batch created: ${batchId}`, {
    mode,
    chunks: chunks.length,
    totalEpisodes: episodes.length,
  });

  // Poll for completion
  const batch = await pollBatchCompletion(batchId, 900000);

  if (!batch.results || batch.results.length === 0) {
    throw new Error("No results returned from persona pattern extraction");
  }

  // Collect all pattern extractions
  const patterns: string[] = [];
  for (const result of batch.results) {
    if (result.error || !result.response) {
      logger.warn(`Pattern extraction failed for ${result.customId}`, {
        error: result.error,
      });
      continue;
    }

    const pattern =
      typeof result.response === "string"
        ? result.response
        : result.response.summary || JSON.stringify(result.response);
    patterns.push(pattern);
  }

  logger.info(`Extracted patterns from ${patterns.length} chunks`, {
    totalChunks: chunks.length,
  });

  // Combine patterns into final persona document
  const finalSummary = await synthesizePatternsIntoPersona(
    patterns,
    existingSummary,
    mode,
    userContext,
    analytics
  );

  return finalSummary;
}

/**
 * Poll batch until completion
 */
async function pollBatchCompletion(batchId: string, maxPollingTime: number) {
  const pollInterval = 5000;
  const startTime = Date.now();

  let batch = await getBatch({ batchId });

  while (batch.status === "processing" || batch.status === "pending") {
    const elapsed = Date.now() - startTime;

    if (elapsed > maxPollingTime) {
      throw new Error(`Batch timed out after ${elapsed}ms`);
    }

    logger.info(`Batch status: ${batch.status}`, {
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
 * Build adaptive persona prompt based on user context
 */
function buildAdaptivePersonaPrompt(
  episodes: EpisodicNode[],
  mode: "full" | "incremental",
  existingSummary: string | null,
  userContext: UserContext,
  analytics: PersonaAnalytics
): CoreMessage {
  const systemPrompt = getSystemPrompt(mode);
  const contextSection = buildContextSection(userContext);
  const analyticsSection = buildAnalyticsSection(analytics);
  const roleGuidance = getRoleGuidance(userContext.role);
  const episodesText = formatEpisodesForPrompt(episodes);

  let content = `${systemPrompt}\n\n`;

  if (mode === "full") {
    content += `
TASK: Generate complete persona from ${episodes.length} episodes.

${contextSection}

${analyticsSection}

${roleGuidance}

## Representative Episodes (${episodes.length} filtered for persona relevance):
${episodesText}

Generate a complete persona document following the template structure.
    `.trim();
  } else {
    content += `
TASK: Update existing persona with new patterns from recent episodes.

EXISTING PERSONA:
${existingSummary}

${contextSection}

${analyticsSection}

NEW EPISODES: ${episodes.length} episodes
${episodesText}

INSTRUCTIONS:
1. Identify changes from new episodes
2. Update relevant sections (LEXICON, RECEIPTS, EXAMPLES, etc.)
3. Preserve stability (don't update unless clear shift detected)
4. Mark updated sections with [UPDATED]

Output the complete updated persona document.
    `.trim();
  }

  return {
    role: "user",
    content,
  };
}

/**
 * Build user context section based on source (onboarding/inferred/none)
 */
function buildContextSection(userContext: UserContext): string {
  if (userContext.source === "onboarding") {
    return `
## User Context (from onboarding):
- Role: ${userContext.role || "Not specified"}
- Goal: ${userContext.goal || "Not specified"}
- Tools: ${userContext.tools?.join(", ") || "Not specified"}
    `.trim();
  } else if (userContext.source === "inferred") {
    return `
## User Context (inferred from episodes):
- Likely Role: ${userContext.role || "Unknown"}
- Tools Used: ${userContext.tools?.join(", ") || "None detected"}

Note: No onboarding data available. Structure should be generic and data-driven.
    `.trim();
  } else {
    return `
## User Context:
- No onboarding data or role inference available
- Create a generic, data-driven persona structure based on observed patterns
    `.trim();
  }
}

/**
 * Build analytics section from quantitative analysis
 */
function buildAnalyticsSection(analytics: PersonaAnalytics): string {
  const topLexicon = Object.entries(analytics.lexicon)
    .slice(0, 20)
    .map(([term, count]) => `- ${term}: ${count}×`)
    .join("\n");

  const sourceDistribution = Object.entries(analytics.sources)
    .map(([source, pct]) => `- ${source}: ${pct}%`)
    .join("\n");

  return `
## Quantitative Foundation (from ${analytics.totalEpisodes} episodes):

### Lexicon (top terms by TF-IDF):
${topLexicon}

### Structural Metrics (objective counts):
- Average sentence length: ${analytics.style.avgSentenceLength} words
- Average paragraph length: ${analytics.style.avgParagraphLength} sentences
- Episodes with bullets: ${analytics.style.episodesWithBullets} (${Math.round((analytics.style.episodesWithBullets / analytics.totalEpisodes) * 100)}%)
- Episodes with code blocks: ${analytics.style.episodesWithCode} (${Math.round((analytics.style.episodesWithCode / analytics.totalEpisodes) * 100)}%)

### Source Distribution:
${sourceDistribution}

### Temporal Stats:
- Time span: ${analytics.temporal.timeSpanDays} days
- Episodes per month: ${analytics.temporal.episodesPerMonth}

**IMPORTANT - How to Use These Analytics:**
1. **LEXICON section**: Use the TF-IDF terms above (with frequencies) as the foundation. Add context from episodes.
2. **STYLE_GUIDE section**: Use the structural metrics above (sentence/paragraph length, bullets, code blocks) as quantitative grounding. Add qualitative observations from episodes.
3. **SOURCE distribution**: Reference this when noting communication patterns (e.g., "38% GitHub issues suggests technical communication").
4. **TEMPORAL patterns**: Use time span and frequency to contextualize evolution/consistency.

DO NOT re-calculate these metrics from episodes - they are already computed. Your job is to INTERPRET and CONTEXTUALIZE them using episode content.
  `.trim();
}

/**
 * Get role-specific guidance for prompt
 */
function getRoleGuidance(role?: string): string {
  if (!role) {
    return "Create flexible structure for any professional based on available data.";
  }

  const guidance: Record<string, string> = {
    Developer: `
**Role-Specific Sections to Consider:**
- CODE_STYLE: Formatting, naming conventions, language preferences
- ARCHITECTURE_PATTERNS: Design patterns, architectural decisions
- DEBUG_APPROACH: Problem-solving strategies, debugging habits
- TOOLING: IDE, extensions, CLI tools, workflows
    `.trim(),
    Designer: `
**Role-Specific Sections to Consider:**
- AESTHETIC_PREFERENCES: Visual style, color theory, typography
- DESIGN_PROCESS: Ideation → prototype → feedback → iterate
- TOOLS: Figma, Sketch, design systems
- INSPIRATION_SOURCES: Where they find design ideas
    `.trim(),
    "Product Manager": `
**Role-Specific Sections to Consider:**
- DECISION_FRAMEWORKS: How they prioritize features
- STAKEHOLDER_COMMUNICATION: Meeting styles, update frequency
- PRIORITIZATION_STYLE: RICE, MoSCoW, or custom approach
- STRATEGY_APPROACH: Long-term thinking patterns
    `.trim(),
    "Engineering Manager": `
**Role-Specific Sections to Consider:**
- LEADERSHIP_STYLE: Direct vs servant leadership
- ONE_ON_ONE_APPROACH: Frequency, structure, topics
- TEAM_RITUALS: Standups, retros, planning
- FEEDBACK_PHILOSOPHY: How they give/receive feedback
    `.trim(),
    "Founder / Executive": `
**Role-Specific Sections to Consider:**
- VISION_ARTICULATION: How they communicate company direction
- DECISION_SPEED: Fast vs deliberate decision-making
- DELEGATION: What they delegate vs do themselves
- STRATEGIC_FRAMEWORKS: Mental models for business decisions
    `.trim(),
  };

  return guidance[role] || "Create structure based on role patterns observed in episodes.";
}

/**
 * Build pattern extraction prompt for batch processing
 */
function buildPatternExtractionPrompt(
  episodes: EpisodicNode[],
  userContext: UserContext,
  analytics: PersonaAnalytics
): CoreMessage {
  const episodesText = formatEpisodesForPrompt(episodes);
  const contextSection = buildContextSection(userContext);
  const analyticsSection = buildAnalyticsSection(analytics);
  const systemPrompt = getSystemPrompt("full"); // Use full mode for consistent extraction principles
  const roleGuidance = getRoleGuidance(userContext.role);

  const content = `
${systemPrompt}

CHUNK ANALYSIS MODE: You are analyzing ONE chunk of a larger dataset. Other chunks are being processed separately.

${contextSection}

${analyticsSection}

${roleGuidance}

TASK: Extract patterns from this chunk of ${episodes.length} episodes. Focus on:
1. LEXICON: Add qualitative CONTEXT for terms already identified in analytics (DON'T re-extract frequencies)
2. STYLE: Add qualitative observations that complement the structural metrics above
3. VOICE: Communication style qualities (tone, formality, analytical balance)
4. BELIEFS: Core principles (if stated multiple times)
5. PREFERENCES: Clear DO/DON'T patterns

EPISODES:
${episodesText}

OUTPUT: Return patterns found in this chunk. Use this format:

# LEXICON_CONTEXT
- [term from analytics]: [usage context in this chunk]

# STYLE_OBSERVATIONS
- [qualitative pattern]: [evidence from this chunk]

# VOICE_PATTERNS
- [quality]: [evidence]

# BELIEF_PATTERNS
- [belief]: [frequency/strength]

# PREFERENCE_PATTERNS
DO:
- [preference]
DON'T:
- [anti-pattern]

# EXAMPLES
- [concrete example from chunk]

IMPORTANT:
- Use analytics as foundation - DON'T re-calculate frequencies or metrics
- Focus on adding CONTEXT and QUALITATIVE insights to the quantitative data
- CHUNK-AWARE: Since you're seeing only part of the data, include patterns even with 2+ mentions in this chunk (synthesis will aggregate)
- Follow the extraction principles above (prescriptive > descriptive, quantify when possible, source-aware)
  `.trim();

  return {
    role: "user",
    content,
  };
}

/**
 * Synthesize extracted patterns into final persona document
 */
async function synthesizePatternsIntoPersona(
  patterns: string[],
  existingSummary: string | null,
  mode: "full" | "incremental",
  userContext: UserContext,
  analytics: PersonaAnalytics
): Promise<string> {
  const allPatterns = patterns.join("\n\n---\n\n");
  const contextSection = buildContextSection(userContext);
  const analyticsSection = buildAnalyticsSection(analytics);
  const roleGuidance = getRoleGuidance(userContext.role);
  const systemPrompt = getSystemPrompt(mode);

  const synthesisPrompt = existingSummary
    ? `
${systemPrompt}

${contextSection}

${analyticsSection}

EXISTING PERSONA:
${existingSummary}

PATTERNS FROM CHUNKS (qualitative context for analytics):
${allPatterns}

TASK: Update the existing persona by:
1. Use analytics above as quantitative foundation
2. Merge pattern context from chunks with existing persona
3. Resolve conflicts (prefer higher frequency patterns from analytics)
4. Maintain the standard persona format (STYLE_GUIDE, LEXICON_USE, VOICE_TONE, etc.)
5. Mark significantly updated sections with [UPDATED]

${roleGuidance}

Output the complete updated persona document following the standard template.
    `.trim()
    : `
${systemPrompt}

${contextSection}

${analyticsSection}

PATTERNS FROM CHUNKS (qualitative context for analytics):
${allPatterns}

TASK: Create a complete persona document by:
1. Use analytics above as quantitative foundation (lexicon frequencies, style metrics, etc.)
2. Integrate qualitative pattern context from chunks
3. Combine quantitative + qualitative into cohesive persona sections
4. Organize into standard persona format

${roleGuidance}

Use this format:

# STYLE_GUIDE
[Use structural metrics from analytics + qualitative observations from chunks]

# LEXICON_USE
[Use TF-IDF terms from analytics + usage context from chunks]

# VOICE_TONE
[Communication style parameters from pattern observations]

# WORLDVIEW
[Core beliefs and principles from chunks]

# RECEIPTS
[Achievements and metrics]

# DO_DONT
DO:
- [preferred approaches]
DON'T:
- [anti-patterns]

# FORMATS
[Preferred output structures]

# MESSAGING
[Tagline, positioning if available]

# GOALS
[Stated goals]

# EXAMPLES
[Concrete examples]

Output the complete persona document.
    `.trim();

  const batchRequest = {
    customId: `persona-synthesis-${Date.now()}`,
    messages: [
      {
        role: "user",
        content: synthesisPrompt,
      } as CoreMessage,
    ],
    systemPrompt: "",
  };

  const { batchId } = await createBatch({
    requests: [batchRequest],
    outputSchema: PersonaSummarySchema,
    maxRetries: 3,
    timeoutMs: 600000,
  });

  logger.info(`Persona synthesis batch created: ${batchId}`);

  const batch = await pollBatchCompletion(batchId, 600000);

  if (!batch.results || batch.results.length === 0) {
    throw new Error("Persona synthesis batch failed");
  }

  const result = batch.results[0];
  if (result.error || !result.response) {
    throw new Error(`Persona synthesis failed: ${result.error || "No response"}`);
  }

  const summary =
    typeof result.response === "string"
      ? result.response
      : result.response.summary || JSON.stringify(result.response);

  logger.info("Persona synthesized from patterns", {
    summaryLength: summary.length,
    patternChunks: patterns.length,
  });

  return summary;
}

/**
 * System prompt with extraction principles
 */
function getSystemPrompt(mode: "full" | "incremental"): string {
  return `
You are a persona analyst extracting communication patterns and behavioral traits from conversation episodes.

Your goal: Create an actionable persona document that agents can use to understand HOW this person communicates, thinks, and operates.

CRITICAL: Extract PRESCRIPTIVE patterns (rules to follow), not DESCRIPTIVE summaries (what happened).

Bad: "User discussed the importance of concise communication"
Good: "Sentence length: 12-18 words; 1 short punch/paragraph"

EXTRACTION PRINCIPLES:

1. USE PROVIDED ANALYTICS AS FOUNDATION
   - You will receive pre-computed TF-IDF lexicon, structural metrics, source distribution, and temporal stats
   - DO NOT re-calculate these metrics from episodes
   - USE them as quantitative grounding and ADD qualitative context from episodes
   - Example: Given "startup: 200×" in lexicon → "startup (200+ mentions): Focus on early-stage companies, MVP development..."

2. FREQUENCY MATTERS
   - If term appears 10+ times → Add to LEXICON
   - If pattern appears 5+ times → Add to section
   - Rare mentions → Ignore (noise)

3. PRESCRIPTIVE > DESCRIPTIVE
   - Extract rules: "Always X", "Never Y", "Prefer Z"
   - Extract preferences: "Use X instead of Y"
   - Extract patterns: "When doing X, then Y"

4. QUANTIFY WHEN POSSIBLE
   - Style metrics: Use provided averages (sentence length, paragraph length) + add qualitative observations
   - Tone sliders: formality (1-5), analytical (1-5)
   - Frequency: Use provided TF-IDF counts + context

5. CONTEXT MATTERS
   - Note if patterns vary by context (technical vs personal)
   - Track evolution: "Previously X, now Y"
   - Identify contradictions: "Says X but does Y"

6. SOURCE-AWARE EXTRACTION
   - Use provided source distribution percentages
   - Weight authored content (Obsidian docs, GitHub issues) higher for style analysis
   - Agent conversations show interaction patterns
   - Multi-source consistency indicates strong pattern

OUTPUT FORMAT: Structured markdown with sections appropriate for the user's role/context.
Standard sections include: STYLE_GUIDE, LEXICON_USE, VOICE_TONE, WORLDVIEW, RECEIPTS, DO_DONT, FORMATS, MESSAGING, GOALS, EXAMPLES

IMPORTANT: Skip sections with insufficient data (<3 relevant mentions).
${mode === "incremental" ? "\nFor incremental updates: Focus on NEW patterns, preserve existing unless contradicted." : ""}
  `.trim();
}

/**
 * Format episodes for inclusion in prompt
 */
function formatEpisodesForPrompt(episodes: EpisodicNode[]): string {
  return episodes
    .map((episode, index) => {
      const date = new Date(episode.createdAt).toISOString().split("T")[0];
      const source = episode.source || "unknown";

      return `
Episode ${index + 1} (${date}, source: ${source}):
${episode.content}
      `.trim();
    })
    .join("\n\n");
}

/**
 * Process persona generation job (BullMQ worker entry point)
 * Orchestrates fetching data, calling generation logic, and updating database
 *
 * @param pythonRunner - Optional Python runner for Trigger.dev compatibility
 */
export async function processPersonaGeneration(
  payload: PersonaGenerationPayload,
  clusteringRunner?: (userId: string, startTime?: string) => Promise<string>,
  analyticsRunner?: (userId: string, startTime?: string) => Promise<string>,
): Promise<PersonaGenerationResult> {
  const { userId, workspaceId, spaceId, mode, startTime } = payload;

  logger.info("Starting persona generation", {
    userId,
    workspaceId,
    spaceId,
    mode,
    startTime,
  });

  const spaceService = new SpaceService();

  try {
    // Get persona space
    const personaSpace = await spaceService.getSpace(spaceId, userId);

    if (!personaSpace) {
      throw new Error(`Persona space not found: ${spaceId}`);
    }

    // Get all episodes for persona generation
    const episodes = await getEpisodesByUserId({userId, startTime});

    if (episodes.length === 0) {
      logger.warn("No episodes found for persona generation", {
        userId,
        spaceId,
      });
      return {
        success: true,
        spaceId,
        mode,
        summaryLength: 0,
        episodesProcessed: 0,
      };
    }

    logger.info("Generating persona summary", {
      userId,
      spaceId,
      episodeCount: episodes.length,
      mode,
    });

    // Generate persona summary (calls Python analytics + clustering + LLM logic)
    const summary = await generatePersonaSummary(
      episodes,
      mode,
      personaSpace.summary || null,
      userId,
      spaceId,
      startTime,
      clusteringRunner,
      analyticsRunner
    );

    // Update persona space with new summary
    await spaceService.updateSpace(spaceId, { summary }, userId);

    // Update episode count tracking for threshold checking
    const totalEpisodesQuery = `
      MATCH (e:Episode {userId: $userId})
      RETURN count(e) as totalCount
    `;
    const countResult = await runQuery(totalEpisodesQuery, { userId });
    const currentTotalCount = countResult[0]?.get("totalCount").toNumber() || 0;

    const updateCountQuery = `
      MATCH (space:Space {uuid: $spaceId, userId: $userId})
      SET space.episodeCountAtLastSummary = $currentCount,
          space.summaryGeneratedAt = datetime(),
          space.updatedAt = datetime()
      RETURN space
    `;
    await runQuery(updateCountQuery, {
      spaceId,
      userId,
      currentCount: currentTotalCount,
    });

    logger.info("Persona generation completed", {
      userId,
      spaceId,
      mode,
      summaryLength: summary.length,
      episodesProcessed: episodes.length,
    });

    return {
      success: true,
      spaceId,
      mode,
      summaryLength: summary.length,
      episodesProcessed: episodes.length,
    };
  } catch (error) {
    logger.error("Error in persona generation:", {
      error,
      userId,
      spaceId,
      mode,
    });
    throw error;
  }
}
