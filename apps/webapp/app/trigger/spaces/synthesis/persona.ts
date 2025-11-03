import { logger } from "~/services/logger.service";
import type { CoreMessage } from "ai";
import { createBatch, getBatch } from "~/lib/batch.server";
import { z } from "zod";
import { getUserContext, type UserContext } from "~/services/user-context.server";
import {
  analyzeEpisodesAlgorithmically,
  type PersonaAnalytics,
} from "~/services/persona-analytics.server";
import { assignEpisodesToSpace } from "~/services/graphModels/space";
import { python } from "@trigger.dev/python";
import type { EpisodicNode } from "@core/types";

interface BERTopicOutput {
  topics: Record<
    string,
    {
      keywords: string[];
      episodeIds: string[];
    }
  >;
}

interface BERTopicCluster {
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
 * 3. BERTopic clustering + intelligent filtering (persona-relevant topics only)
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
): Promise<string> {
  logger.info("Starting persona generation pipeline", {
    episodeCount: episodes.length,
    mode,
    hasExistingSummary: !!existingSummary,
    userId,
    spaceId,
  });

  // Stage 1: Get user context (onboarding → inferred → generic)
  const userContext = await getUserContext(userId);
  logger.info("User context retrieved", {
    source: userContext.source,
    hasRole: !!userContext.role,
    hasGoal: !!userContext.goal,
    toolsCount: userContext.tools?.length || 0,
  });

  // Stage 2: Algorithmic analytics on ALL episodes (no sampling)
  const analytics = await analyzeEpisodesAlgorithmically(episodes);
  logger.info("Algorithmic analytics complete", {
    lexiconTerms: Object.keys(analytics.lexicon).length,
    avgSentenceLength: analytics.style.avgSentenceLength,
    timeSpanDays: analytics.temporal.timeSpanDays,
  });

  // Stage 3: Intelligent episode filtering via BERTopic
  let filteredEpisodes = episodes;
  if (episodes.length > 50) {
    // Always run BERTopic for larger datasets
    try {
      const clusters = await clusterEpisodes(userId);
      const personaClusters = filterPersonaRelevantTopics(clusters);

      // Extract episode IDs from persona-relevant clusters
      const personaEpisodeIds = new Set<string>();
      for (const cluster of personaClusters) {
        cluster.episodeIds.forEach((id) => personaEpisodeIds.add(id));
      }

      filteredEpisodes = episodes.filter((e) => personaEpisodeIds.has(e.uuid));

      logger.info("BERTopic filtering complete", {
        totalClusters: Object.keys(clusters.topics).length,
        personaClusters: personaClusters.length,
        originalEpisodes: episodes.length,
        filteredEpisodes: filteredEpisodes.length,
      });
    } catch (error) {
      logger.warn("BERTopic filtering failed, using all episodes", {
        error: error instanceof Error ? error.message : "Unknown error",
      });
      // Fall back to using all episodes if BERTopic fails
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
 * Run BERTopic clustering via Python script using Trigger.dev Python runner
 */
async function clusterEpisodes(userId: string): Promise<BERTopicOutput> {
  const args = [
    userId,
    "--min-topic-size", "10",
    "--neo4j-uri", process.env.NEO4J_URI || "",
    "--neo4j-user", process.env.NEO4J_USERNAME || "",
    "--neo4j-password", process.env.NEO4J_PASSWORD || "",
    "--quiet"
  ];

  logger.info("Running BERTopic clustering with Trigger.dev Python", { userId });

  const result = await python.runScript("./python/persona_topics.py", args);
  return JSON.parse(result.stdout);
}

/**
 * Filter BERTopic clusters to only persona-relevant topics
 * Excludes project-specific topics (CORE architecture, SOL tasks, etc.)
 */
function filterPersonaRelevantTopics(clusters: BERTopicOutput): BERTopicCluster[] {
  const PERSONA_KEYWORDS = [
    "email",
    "message",
    "communication",
    "writing",
    "tone",
    "outreach",
    "style",
    "workflow",
    "process",
    "routine",
    "schedule",
    "productivity",
    "habit",
    "ritual",
    "tool",
    "software",
    "platform",
    "framework",
    "preference",
    "setup",
    "config",
    "decide",
    "choice",
    "priority",
    "strategy",
    "principle",
    "approach",
    "method",
    "team",
    "collaborate",
    "feedback",
    "review",
    "meeting",
    "stakeholder",
    "learn",
    "study",
    "practice",
    "documentation",
    "research",
    "skill",
    "believe",
    "value",
    "mindset",
    "philosophy",
    "opinion",
    "perspective",
    "profile",
    "health",
    "personal",
    "interest",
    "background",
    "experience",
    "hobby",
  ];

  const PROJECT_KEYWORDS = [
    "core",
    "architecture",
    "memory",
    "graph",
    "neo4j",
    "prisma",
    "sol",
    "task",
    "feature",
    "bug",
    "implementation",
    "deployment",
    "github",
    "runner",
    "docker",
    "build",
    "ci",
    "cd",
    "terraform",
    "aws",
  ];

  return Object.entries(clusters.topics)
    .map(([topicId, data]) => ({
      topicId,
      keywords: data.keywords,
      episodeIds: data.episodeIds,
    }))
    .filter((cluster) => {
      // Calculate persona relevance score
      const personaScore = cluster.keywords.filter((kw) =>
        PERSONA_KEYWORDS.some((pk) => kw.toLowerCase().includes(pk))
      ).length;

      // Calculate project-specific score (penalty)
      const projectScore = cluster.keywords.filter((kw) =>
        PROJECT_KEYWORDS.some((prk) => kw.toLowerCase().includes(prk))
      ).length;

      // Keep if: ≥2 persona keywords AND fewer project keywords
      return personaScore >= 2 && projectScore < personaScore;
    });
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
    userContext
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
## Quantitative Analysis (from ${analytics.totalEpisodes} episodes):

### Lexicon (top terms):
${topLexicon}

### Style Metrics:
- Average sentence length: ${analytics.style.avgSentenceLength} words
- Bullet list usage: ${analytics.style.bulletUsage}%
- Code block frequency: ${analytics.style.codeBlockFrequency}%
- Emphasis: ${analytics.style.emphasisPatterns.bold} bold, ${analytics.style.emphasisPatterns.italic} italic, ${analytics.style.emphasisPatterns.caps} CAPS

### Source Distribution:
${sourceDistribution}

### Temporal:
- Time span: ${analytics.temporal.timeSpanDays} days
- Episodes per month: ${analytics.temporal.episodesPerMonth}

### Receipts (explicit metrics):
${analytics.receipts.join(", ") || "None found"}
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

  const content = `
You are analyzing a chunk of conversation episodes to extract behavioral and communication patterns.

${contextSection}

TASK: Extract patterns from this chunk of ${episodes.length} episodes. Focus on:
1. LEXICON: Frequently used terms (note frequency)
2. STYLE: Writing mechanics (sentence length, structure, formatting)
3. VOICE: Communication style qualities
4. BELIEFS: Core principles (if stated multiple times)
5. PREFERENCES: Clear DO/DON'T patterns

EPISODES:
${episodesText}

OUTPUT: Return patterns found in this chunk. Use this format:

# LEXICON_PATTERNS
- [term]: [frequency in this chunk] - [usage context]

# STYLE_PATTERNS
- [pattern]: [observation]

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

IMPORTANT: Only include patterns with sufficient evidence (3+ mentions in chunk).
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
  userContext: UserContext
): Promise<string> {
  const allPatterns = patterns.join("\n\n---\n\n");
  const contextSection = buildContextSection(userContext);
  const roleGuidance = getRoleGuidance(userContext.role);

  const synthesisPrompt = existingSummary
    ? `
You are synthesizing patterns from multiple episode chunks into a cohesive persona document.

${contextSection}

EXISTING PERSONA:
${existingSummary}

NEW PATTERNS FROM CHUNKS:
${allPatterns}

TASK: Update the existing persona by:
1. Merging new patterns with existing ones
2. Resolving conflicts (prefer higher frequency patterns)
3. Maintaining the standard persona format (STYLE_GUIDE, LEXICON_USE, VOICE_TONE, etc.)
4. Marking significantly updated sections with [UPDATED]

${roleGuidance}

Output the complete updated persona document following the standard template.
    `.trim()
    : `
You are synthesizing patterns from multiple episode chunks into a cohesive persona document.

${contextSection}

PATTERNS FROM CHUNKS:
${allPatterns}

TASK: Create a complete persona document by:
1. Aggregating patterns across all chunks
2. Calculating overall frequencies
3. Identifying strongest patterns
4. Organizing into standard persona format

${roleGuidance}

Use this format:

# STYLE_GUIDE
[Writing mechanics and formatting]

# LEXICON_USE
[Domain terms with aggregated frequencies]

# VOICE_TONE
[Communication style parameters]

# WORLDVIEW
[Core beliefs and principles]

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

1. FREQUENCY MATTERS
   - If term appears 10+ times → Add to LEXICON
   - If pattern appears 5+ times → Add to section
   - Rare mentions → Ignore (noise)

2. PRESCRIPTIVE > DESCRIPTIVE
   - Extract rules: "Always X", "Never Y", "Prefer Z"
   - Extract preferences: "Use X instead of Y"
   - Extract patterns: "When doing X, then Y"

3. QUANTIFY WHEN POSSIBLE
   - Style metrics: sentence length, paragraph length
   - Tone sliders: formality (1-5), analytical (1-5)
   - Frequency: "mentioned 15 times across 50 episodes"

4. CONTEXT MATTERS
   - Note if patterns vary by context (technical vs personal)
   - Track evolution: "Previously X, now Y"
   - Identify contradictions: "Says X but does Y"

5. SOURCE-AWARE EXTRACTION
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
      const date = episode.createdAt.toISOString().split("T")[0];
      const source = episode.source || "unknown";

      return `
Episode ${index + 1} (${date}, source: ${source}):
${episode.content}
      `.trim();
    })
    .join("\n\n");
}
