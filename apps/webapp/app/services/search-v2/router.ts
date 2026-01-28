import { ProviderFactory, VECTOR_NAMESPACES } from "@core/providers";
import {
  getEmbedding,
  makeStructuredModelCall,
} from "~/lib/model.server";
import { logger } from "~/services/logger.service";

import {
  AspectExtractionSchema,
  type AspectExtraction,
  type LabelMatch,
  type RouterOutput,
  type QueryType,
  type TemporalFilter,
  type LookupMode,
  ASPECT_DEFINITIONS,
  QUERY_TYPE_DEFINITIONS,
} from "./types";
import { type StatementAspect, StatementAspects } from "@core/types";
import { prisma } from "~/db.server";

/**
 * Build the aspect extraction prompt for LLM
 * @param matchedLabels - Labels matched from vector search to provide context
 */
function buildAspectExtractionPrompt(matchedLabels: LabelMatch[] = []): string {
  const aspectList = StatementAspects.map(
    (aspect) => `- **${aspect}**: ${ASPECT_DEFINITIONS[aspect]}`
  ).join("\n");

  const queryTypeList = Object.entries(QUERY_TYPE_DEFINITIONS)
    .map(([type, desc]) => `- **${type}**: ${desc}`)
    .join("\n");

  // Add matched labels context if available
  const labelsContext = matchedLabels.length > 0
    ? `\n## Matched Topics (from vector search)
The following topics were matched for this query:
${matchedLabels.map((l) => `- **${l.labelName}** (score: ${l.score.toFixed(2)})`).join("\n")}

You MUST select which of these topics are relevant to the query and include them in selectedLabels. ONLY use the exact label names listed above.\n`
    : `\n## Matched Topics
No topics were matched from vector search. You MUST return selectedLabels as an empty array []. DO NOT invent or hallucinate any label names.\n`;

  return `You are a search query analyzer for a personal knowledge graph system. Your job is to extract structured information from natural language queries.
${labelsContext}
## Statement Aspects
The knowledge graph stores facts classified into these aspects:
${aspectList}

## Query Types
Classify the query into one of these types:
${queryTypeList}

## Entity Lookup Modes
For entity_lookup queries, determine the lookup mode:
- **attribute**: User wants a specific attribute (phone number, email, team, role, title, location, etc.)
- **broad**: User wants general information about the entity ("Who is X?", "Tell me about X", "anything about X")

## Instructions
Queries can be direct questions OR agent intent descriptions (e.g., "Need context about X to help with Y"). Handle both patterns.

1. Extract which aspects are relevant to the query
2. Classify the query type based on what information is needed (not how it's phrased)
3. Extract temporal information if mentioned (including implied recency like "recent", "catch up", "latest")
4. Identify entity names mentioned (can be people, projects, concepts, technologies)
5. Determine if this actually requires a memory search
${matchedLabels.length > 0 ? `6. Select which matched topics are relevant (output in selectedLabels). Only include topics that directly relate to the query intent. Use the exact label names provided above. DO NOT invent label names.` : `6. Since no topics were matched, return selectedLabels as an empty array []. DO NOT create or invent any label names.`}
7. For entity_lookup queries: set lookupMode to "attribute" if asking for specific attribute, "broad" otherwise. Set attributeHint to the attribute name if lookupMode is "attribute".

## Examples
${matchedLabels.length > 0 ? `
(With matched topics: "Fitness Goals" (0.85), "Health Tracking" (0.72), "Work Projects" (0.45))
Query: "What are my fitness goals?"
→ aspects: ["Goal"], queryType: "aspect_query", temporal: {type: "all", ...}, entityHints: [], selectedLabels: ["Fitness Goals", "Health Tracking"], lookupMode: "broad", attributeHint: null, shouldSearch: true

(With matched topics: "Email Writing Style" (0.80), "Personal Finance" (0.58), "Persona" (0.54))
Query: "How do I write emails?"
→ aspects: ["Preference", "Knowledge"], queryType: "aspect_query", temporal: {type: "all", ...}, entityHints: [], selectedLabels: ["Email Writing Style"], lookupMode: "broad", attributeHint: null, shouldSearch: true
` : `
(No matched topics - selectedLabels MUST be empty array)
`}
Query: "What are my fitness goals?"
→ aspects: ["Goal"], queryType: "aspect_query", temporal: {type: "all", days: null, startDate: null, endDate: null}, entityHints: [], selectedLabels: [], lookupMode: "broad", attributeHint: null, shouldSearch: true

Query: "Need to understand what preferences and goals the user has for fitness tracking"
→ aspects: ["Preference", "Goal"], queryType: "aspect_query", temporal: {type: "all", days: null, startDate: null, endDate: null}, entityHints: ["fitness"], selectedLabels: [], lookupMode: "broad", attributeHint: null, shouldSearch: true

Query: "What is John's phone number?"
→ aspects: ["Identity"], queryType: "entity_lookup", temporal: {type: "all", days: null, startDate: null, endDate: null}, entityHints: ["John"], selectedLabels: [], lookupMode: "attribute", attributeHint: "phone", shouldSearch: true

Query: "John's email address?"
→ aspects: ["Identity"], queryType: "entity_lookup", temporal: {type: "all", days: null, startDate: null, endDate: null}, entityHints: ["John"], selectedLabels: [], lookupMode: "attribute", attributeHint: "email", shouldSearch: true

Query: "What team does Sarah work on?"
→ aspects: ["Identity", "Relationship"], queryType: "entity_lookup", temporal: {type: "all", days: null, startDate: null, endDate: null}, entityHints: ["Sarah"], selectedLabels: [], lookupMode: "attribute", attributeHint: "team", shouldSearch: true

Query: "Who is Sarah?"
→ aspects: ["Identity"], queryType: "entity_lookup", temporal: {type: "all", days: null, startDate: null, endDate: null}, entityHints: ["Sarah"], selectedLabels: [], lookupMode: "broad", attributeHint: null, shouldSearch: true

Query: "anything about airbnb email"
→ aspects: ["Knowledge", "Action"], queryType: "entity_lookup", temporal: {type: "all", days: null, startDate: null, endDate: null}, entityHints: ["airbnb email"], selectedLabels: [], lookupMode: "broad", attributeHint: null, shouldSearch: true

Query: "Looking for information about Sarah to understand her role and background"
→ aspects: ["Identity", "Knowledge"], queryType: "entity_lookup", temporal: {type: "all", days: null, startDate: null, endDate: null}, entityHints: ["Sarah"], selectedLabels: [], lookupMode: "broad", attributeHint: null, shouldSearch: true

Query: "What happened last week with the CORE project?"
→ aspects: ["Event", "Action"], queryType: "temporal", temporal: {type: "recent", days: 7, startDate: null, endDate: null}, entityHints: ["CORE"], selectedLabels: [], lookupMode: "broad", attributeHint: null, shouldSearch: true

Query: "Need recent context about CORE project activities to catch up on progress"
→ aspects: ["Action", "Event", "Decision"], queryType: "temporal", temporal: {type: "recent", days: 7, startDate: null, endDate: null}, entityHints: ["CORE"], selectedLabels: [], lookupMode: "broad", attributeHint: null, shouldSearch: true

Query: "search implementation in CORE"
→ aspects: ["Knowledge", "Action", "Decision"], queryType: "exploratory", temporal: {type: "all", days: null, startDate: null, endDate: null}, entityHints: ["search", "CORE"], selectedLabels: [], lookupMode: "broad", attributeHint: null, shouldSearch: true

Query: "I need context about authentication implementation and security discussions to help review this PR"
→ aspects: ["Knowledge", "Action", "Decision"], queryType: "exploratory", temporal: {type: "all", days: null, startDate: null, endDate: null}, entityHints: ["authentication", "security"], selectedLabels: [], lookupMode: "broad", attributeHint: null, shouldSearch: true

Query: "How does John know Mike?"
→ aspects: ["Relationship"], queryType: "relationship", temporal: {type: "all", days: null, startDate: null, endDate: null}, entityHints: ["John", "Mike"], selectedLabels: [], lookupMode: "broad", attributeHint: null, shouldSearch: true

Query: "Need to understand the connection between John and Mike for team planning"
→ aspects: ["Relationship"], queryType: "relationship", temporal: {type: "all", days: null, startDate: null, endDate: null}, entityHints: ["John", "Mike"], selectedLabels: [], lookupMode: "broad", attributeHint: null, shouldSearch: true

Query: "Hello!"
→ aspects: [], queryType: "exploratory", temporal: {type: "all", days: null, startDate: null, endDate: null}, entityHints: [], selectedLabels: [], lookupMode: "broad", attributeHint: null, shouldSearch: false

Query: "What's the weather like?"
→ aspects: [], queryType: "exploratory", temporal: {type: "all", days: null, startDate: null, endDate: null}, entityHints: [], selectedLabels: [], lookupMode: "broad", attributeHint: null, shouldSearch: false`;
}

/**
 * Perform vector search on labels to find matching topics
 * Uses pre-stored label embeddings in the vector database
 */
async function searchLabels(
  intent: string,
  workspaceId: string,
  limit: number = 3
): Promise<LabelMatch[]> {
  const startTime = Date.now();
  const vectorProvider = ProviderFactory.getVectorProvider();

  // Get embedding for intent
  const intentEmbedding = await getEmbedding(intent);

  if (!intentEmbedding || intentEmbedding.length === 0) {
    logger.warn("[Router] Failed to get embedding for intent");
    return [];
  }

  // Search labels using vector provider - labels already have embeddings stored
  const searchResults = await vectorProvider.search({
    vector: intentEmbedding,
    namespace: VECTOR_NAMESPACES.LABEL,
    limit,
    filter: { workspaceId },
    threshold: 0.7, // Low threshold to get candidates, we'll filter by score later
  });

  if (searchResults.length === 0) {
    logger.info("[Router] No matching labels found");
    return [];
  }

  // Get label names from database
  const labelIds = searchResults.map((match) => match.id);
  const labels = await prisma.label.findMany({
    where: {
      id: { in: labelIds },
    },
    select: {
      id: true,
      name: true,
    },
  });

  // Create a map of label ID to name
  const labelNameMap = new Map(labels.map((label) => [label.id, label.name]));

  // Transform search results to LabelMatch format
  const result: LabelMatch[] = searchResults.map((match) => ({
    labelId: match.id,
    labelName: labelNameMap.get(match.id) || match.id,
    score: match.score,
  }));

  logger.info(
    `[Router] Label search completed in ${Date.now() - startTime}ms. Matches: ${result.map((r) => `${r.labelName}(${r.score.toFixed(2)})`).join(", ")}`
  );

  return result;
}

/**
 * Extract aspects and query type from intent using LLM
 * @param intent - The search query
 * @param matchedLabels - Labels matched from vector search to provide context
 */
async function extractAspects(
  intent: string,
  matchedLabels: LabelMatch[] = []
): Promise<AspectExtraction> {
  const startTime = Date.now();

  const systemPrompt = buildAspectExtractionPrompt(matchedLabels);

  try {
    // Generate cache key based on whether we have labels (different prompts)
    const cacheKey = matchedLabels.length > 0
      ? `search-v2-router-with-labels`
      : "search-v2-router";

    const { object } = await makeStructuredModelCall(
      AspectExtractionSchema,
      [
        { role: "system", content: systemPrompt },
        { role: "user", content: `Query: "${intent}"` },
      ],
      "high", // Use low-complexity model for cost efficiency
      cacheKey
    );

    logger.info(
      `[Router] Aspect extraction completed in ${Date.now() - startTime}ms. ` +
        `Type: ${object.queryType}, Aspects: [${object.aspects.join(", ")}], ` +
        `SelectedLabels: [${object.selectedLabels?.join(", ") || ""}], ` +
        `Entities: [${object.entityHints.join(", ")}], ` +
        `LookupMode: ${object.lookupMode}, AttributeHint: ${object.attributeHint || "none"}, ` +
        `Confidence: ${object.confidence}`
    );

    return object;
  } catch (error) {
    logger.error(`[Router] Aspect extraction failed: ${error}`);

    // Return default values on error
    return {
      aspects: [],
      queryType: "exploratory",
      temporal: { type: "all", days: null, startDate: null, endDate: null },
      shouldSearch: true,
      entityHints: [],
      selectedLabels: [],
      lookupMode: "broad",
      attributeHint: null,
      confidence: 0.3,
    };
  }
}

/**
 * Route an intent through the hybrid router
 * Runs vector label matching first, then passes results to LLM aspect extraction
 */
export async function routeIntent(
  intent: string,
  userId: string,
  workspaceId: string
): Promise<RouterOutput> {
  const startTime = Date.now();

  logger.info(`[Router] Routing intent: "${intent.slice(0, 100)}..."`);

  // Step 1: Run label search first (fast, ~400ms)
  const labelMatches = await searchLabels(intent, workspaceId);

  // Step 2: Run aspect extraction with label context
  const aspectExtraction = await extractAspects(intent, labelMatches);

  const routingTimeMs = Date.now() - startTime;

  const result: RouterOutput = {
    matchedLabels: labelMatches,
    aspects: aspectExtraction.aspects as StatementAspect[],
    queryType: aspectExtraction.queryType as QueryType,
    temporal: aspectExtraction.temporal as TemporalFilter,
    shouldSearch: aspectExtraction.shouldSearch,
    entityHints: aspectExtraction.entityHints,
    selectedLabels: aspectExtraction.selectedLabels || [],
    lookupMode: aspectExtraction.lookupMode as "attribute" | "broad",
    attributeHint: aspectExtraction.attributeHint,
    confidence: aspectExtraction.confidence,
    routingTimeMs,
  };

  logger.info(
    `[Router] Routing completed in ${routingTimeMs}ms. ` +
      `Labels: [${labelMatches.map((l) => l.labelName).join(", ")}], ` +
      `Selected: [${result.selectedLabels.join(", ")}], ` +
      `QueryType: ${result.queryType}, LookupMode: ${result.lookupMode}, ` +
      `AttributeHint: ${result.attributeHint || "none"}, ShouldSearch: ${result.shouldSearch}`
  );

  return result;
}

/**
 * Check if the router output indicates a valid search request
 */
export function shouldProceedWithSearch(routerOutput: RouterOutput): boolean {
  // Don't search if LLM said not to
  if (!routerOutput.shouldSearch) {
    return false;
  }

  // Don't search if confidence is too low
  if (routerOutput.confidence < 0.2) {
    return false;
  }

  return true;
}

/**
 * Get label IDs from router output
 * Uses LLM-selected labels if available, otherwise falls back to score threshold
 */
export function getMatchedLabelIds(
  routerOutput: RouterOutput,
  threshold: number = 0.5
): string[] {
  // If LLM selected specific labels, use those
  if (routerOutput.selectedLabels && routerOutput.selectedLabels.length > 0) {
    const selectedSet = new Set(routerOutput.selectedLabels.map((n) => n.toLowerCase()));
    return routerOutput.matchedLabels
      .filter((l) => selectedSet.has(l.labelName.toLowerCase()))
      .map((l) => l.labelId);
  }

  // Fallback to score threshold
  return routerOutput.matchedLabels
    .filter((l) => l.score >= threshold)
    .map((l) => l.labelId);
}
