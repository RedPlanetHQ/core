import { type StatementAspect, StatementAspects } from "@core/types";
import { z } from "zod";

/**
 * Query types for the router to classify
 */
export const QueryTypes = [
  "entity_lookup", // Direct entity information lookup
  "aspect_query", // Filter by statement aspects (most common)
  "temporal", // Time-based queries (recent, last week, etc.)
  "exploratory", // Open-ended exploration (what do you know about X)
  "relationship", // Connections between entities
] as const;

export type QueryType = (typeof QueryTypes)[number];

/**
 * Temporal filter specification
 */
export const TemporalTypeSchema = z.enum([
  "recent", // Last N days
  "range", // Between start and end
  "before", // Before a date
  "after", // After a date
  "all", // No temporal filter
]);

export type TemporalType = z.infer<typeof TemporalTypeSchema>;

// Using discriminated union for proper OpenAI structured output support
export const TemporalFilterSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("recent"),
    days: z.number(),
    startDate: z.null(),
    endDate: z.null(),
  }),
  z.object({
    type: z.literal("range"),
    days: z.null(),
    startDate: z.string(),
    endDate: z.string(),
  }),
  z.object({
    type: z.literal("before"),
    days: z.null(),
    startDate: z.null(),
    endDate: z.string(),
  }),
  z.object({
    type: z.literal("after"),
    days: z.null(),
    startDate: z.string(),
    endDate: z.null(),
  }),
  z.object({
    type: z.literal("all"),
    days: z.null(),
    startDate: z.null(),
    endDate: z.null(),
  }),
]);

export type TemporalFilter = z.infer<typeof TemporalFilterSchema>;

/**
 * Lookup modes for entity_lookup queries
 */
export const LookupModes = ["attribute", "broad"] as const;
export type LookupMode = (typeof LookupModes)[number];

/**
 * Zod schema for LLM aspect extraction output
 */
export const AspectExtractionSchema = z.object({
  // Extracted aspects from the query
  aspects: z
    .array(z.enum(StatementAspects as unknown as [string, ...string[]]))
    .describe("Statement aspects relevant to this query"),

  // Query type classification
  queryType: z
    .enum(QueryTypes as unknown as [string, ...string[]])
    .describe("Classification of the query type"),

  // Temporal filtering
  temporal: TemporalFilterSchema.describe(
    "Temporal filter extracted from the query"
  ),

  // Whether to actually search (false for greetings, meta-questions, etc.)
  shouldSearch: z
    .boolean()
    .describe("Whether this query requires a memory search"),

  // Entity hints extracted from the query
  entityHints: z
    .array(z.string())
    .describe("Entity names mentioned in the query"),

  // Selected labels to filter by (from matched labels provided in context)
  selectedLabels: z
    .array(z.string())
    .describe("Label names from the matched topics that are relevant to this query. Only include labels that directly relate to the query intent."),

  // For entity_lookup: whether to look up a specific attribute or broad info
  lookupMode: z
    .enum(LookupModes as unknown as [string, ...string[]])
    .describe("For entity_lookup queries: 'attribute' for specific attribute lookup (phone, email, etc.), 'broad' for general entity information"),

  // For entity_lookup with attribute mode: which attribute to look up
  attributeHint: z
    .string()
    .nullable()
    .describe("For entity_lookup with lookupMode='attribute': the specific attribute being asked for (e.g., 'phone', 'email', 'team', 'role'). Null for broad lookups."),

  // Search confidence (how well we understood the query)
  confidence: z
    .number()
    .min(0)
    .max(1)
    .describe("Confidence in the extraction (0-1)"),
});

export type AspectExtraction = z.infer<typeof AspectExtractionSchema>;

/**
 * Label match from vector search
 */
export interface LabelMatch {
  labelId: string;
  labelName: string;
  score: number;
}

/**
 * Combined router output (vector labels + LLM aspects)
 */
export interface RouterOutput {
  // From vector search on labels
  matchedLabels: LabelMatch[];

  // From LLM extraction
  aspects: StatementAspect[];
  queryType: QueryType;
  temporal: TemporalFilter;
  shouldSearch: boolean;
  entityHints: string[];
  selectedLabels: string[]; // Label names selected by LLM from matchedLabels
  lookupMode: LookupMode; // For entity_lookup: 'attribute' or 'broad'
  attributeHint: string | null; // For entity_lookup attribute mode: which attribute
  confidence: number;

  // Metadata
  routingTimeMs: number;
}

/**
 * Episode in recall results - unified type for episodes, compacted sessions, and documents
 * Matches current search output format
 */
export interface RecallEpisode {
  uuid: string;
  content: string;
  createdAt: Date;
  labelIds: string[];
  isCompact?: boolean;      // True if this is a compacted session
  isDocument?: boolean;     // True if this is a document
  relevanceScore?: number;  // From reranking
}

/**
 * Invalidated fact in recall results
 * Facts that were true but are no longer valid
 */
export interface RecallInvalidatedFact {
  fact: string;
  validAt: Date;
  invalidAt: Date | null;
  relevantScore: number;
}

/**
 * Statement in recall results - minimal fields needed
 */
export interface RecallStatement {
  fact: string;
  validAt: Date;
  attributes: Record<string, string>;
  aspect: StatementAspect | null;
}

/**
 * Entity in recall results
 */
export interface RecallEntity {
  uuid: string;
  name: string;
  attributes: Record<string, string>;
}

/**
 * Main recall result interface (structured output)
 * Matches current search output format for consistency
 */
export interface RecallResult {
  // Episodes (unified: regular, compacted, documents)
  episodes: RecallEpisode[];

  // Invalidated facts (temporal awareness)
  invalidatedFacts?: RecallInvalidatedFact[];

  // Statements (for entity_lookup, relationship queries)
  statements?: RecallStatement[];

  // Entity (for entity_lookup queries)
  entity?: RecallEntity | null;
}

/**
 * Search v2 options
 */
export interface SearchV2Options {
  // Original query (for reranking)
  query?: string;

  // Limits
  limit?: number;
  maxStatements?: number;
  maxEpisodes?: number;

  // Token budget for recall output (default: 10000)
  // Drops least relevant episodes from tail until total tokens <= budget
  tokenBudget?: number;

  // Temporal filters (can be set directly or extracted by router)
  validAt?: Date;
  startTime?: Date;
  endTime?: Date;

  // Label filters (if already known, skip vector search)
  labelIds?: string[];

  // Output format
  structured?: boolean; // true = RecallResult, false = markdown string

  // Sort
  sortBy?: "relevance" | "recency";

  // Fallback behavior
  enableFallback?: boolean;
  fallbackThreshold?: number; // Label match score threshold

  // Reranking
  enableReranking?: boolean;

  // Source tracking (e.g., "Claude-Code", "Cursor", "mcp")
  source?: string;
}

/**
 * Handler context passed to query handlers
 */
export interface HandlerContext {
  userId: string;
  workspaceId: string;
  routerOutput: RouterOutput;
  options: SearchV2Options;
}

/**
 * Fallback strategy types
 */
export const FallbackStrategies = [
  "semantic_search", // Fall back to statement vector search
  "entity_bfs", // Fall back to BFS from entity hints
  "recent_episodes", // Fall back to recent episodes
  "none", // No fallback, return empty
] as const;

export type FallbackStrategy = (typeof FallbackStrategies)[number];

/**
 * Aspect definitions for LLM prompt
 */
export const ASPECT_DEFINITIONS: Record<StatementAspect, string> = {
  Identity:
    "Who they are - role, location, affiliation (slow-changing facts about a person)",
  Knowledge: "What they know - expertise, skills, technical understanding",
  Belief: "Why they think that way - values, opinions, reasoning, worldview",
  Preference:
    "How they want things - likes, dislikes, style choices, preferences",
  Action: "What they do - observable behaviors, habits, practices, activities",
  Goal: "What they want to achieve - future targets, aims, objectives",
  Directive:
    "Rules and automation - always do X, notify when Y, remind me to Z",
  Decision: "Choices made, conclusions reached, determinations",
  Event: "Specific occurrences with timestamps - meetings, milestones, incidents",
  Problem: "Blockers, issues, challenges, obstacles, difficulties",
  Relationship: "Connections between people - who knows whom, team dynamics",
};

/**
 * Query type definitions for LLM prompt
 */
export const QUERY_TYPE_DEFINITIONS: Record<QueryType, string> = {
  entity_lookup:
    "Direct lookup of entity information (e.g., 'Who is John?', 'Tell me about Project X', 'Need information about Sarah for context')",
  aspect_query:
    "Query filtered by statement aspects (e.g., 'What are my goals?', 'What does John prefer?', 'Need to understand user preferences for feature X')",
  temporal:
    "Time-based queries (e.g., 'What happened last week?', 'Recent updates', 'Need recent context about project activities')",
  exploratory:
    "Open-ended exploration and context gathering (e.g., 'What do you know about me?', 'I need context about X to help with Y', 'Looking for information about authentication implementation')",
  relationship:
    "Connections between entities (e.g., 'How does John know Sarah?', 'Who works on Project X?', 'Need to understand connection between A and B')",
};
