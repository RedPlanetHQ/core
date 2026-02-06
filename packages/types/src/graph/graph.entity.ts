/**
 * Interface for document node in the reified knowledge graph
 * Documents are parent containers for episodic chunks
 */
export interface DocumentNode {
  uuid: string;
  title: string;
  originalContent: string;
  metadata: Record<string, any>;
  source: string;
  userId: string;
  workspaceId?: string;
  createdAt: Date;
  validAt: Date;
  totalChunks: number;
  sessionId?: string;
  // Version tracking for differential ingestion
  version: number;
  contentHash: string;
  previousVersionUuid?: string;
  chunkHashes?: string[]; // Hash of each chunk for change detection
}

/**
 * Interface for episodic node in the reified knowledge graph
 * Episodes are containers for statements and represent source information
 * Unified architecture: Both conversations and documents use Episodes with sessionId grouping
 */
export interface EpisodicNode {
  uuid: string;
  content: string;
  originalContent: string;
  contentEmbedding?: number[];
  metadata: Record<string, any>;
  source: string;
  createdAt: Date;
  validAt: Date;
  labelIds: string[];
  userId: string;
  workspaceId?: string;

  // Grouping and chunking
  sessionId: string; // Required - groups chunks together (replaces documentId)
  queueId?: string; // Ingestion queue ID - useful for grouping chunks of same message/document ingestion
  type?: EpisodeType; // CONVERSATION or DOCUMENT
  chunkIndex?: number; // Index of this chunk within the session (0-based)
  totalChunks?: number; // Total chunks in this session

  version?: number; // Version counter (1, 2, 3, ...)
  contentHash?: string; // SHA-256 of entire session content
  previousVersionSessionId?: string; // Links to previous version's sessionId
  // Version tracking (stored on first chunk, chunkIndex=0)
  chunkHashes?: string[]; // Array of hashes for each chunk (for differential detection)

  recallCount?: number;
}

/**
 * Episodic node without embeddings for query responses
 * Use this type when returning episodes from Cypher queries to avoid loading large embedding arrays
 */
export type EpisodicNodeWithoutEmbeddings = Omit<EpisodicNode, "contentEmbedding">;

/**
 * Helper to get episodic node properties for Cypher RETURN clause (excludes embeddings)
 * Usage in Cypher: RETURN ${EPISODIC_NODE_PROPERTIES} as episode
 */
export const EPISODIC_NODE_PROPERTIES = `{
  uuid: e.uuid,
  content: e.content,
  originalContent: e.originalContent,
  source: e.source,
  metadata: e.metadata,
  createdAt: e.createdAt,
  userId: e.userId,
  workspaceId: e.workspaceId,
  sessionId: e.sessionId,
  queueId: e.queueId,
  labelIds: e.labelIds,
  validAt: e.validAt,
  recallCount: e.recallCount,
  type: e.type,
  chunkIndex: e.chunkIndex,
  totalChunks: e.totalChunks,
  version: e.version,
  contentHash: e.contentHash,
  previousVersionSessionId: e.previousVersionSessionId,
  chunkHashes: e.chunkHashes
}`;

export const STATEMENT_NODE_PROPERTIES = `{
  uuid: s.uuid,
  fact: s.fact,
  createdAt: s.createdAt,
  userId: s.userId,
  workspaceId: s.workspaceId,
  validAt: s.validAt,
  invalidAt: s.invalidAt,
  invalidatedBy: s.invalidatedBy,
  attributes: s.attributes,
  aspect: s.aspect,
  recallCount: s.recallCount,
  provenanceCount: s.provenanceCount
}`;

export const ENTITY_NODE_PROPERTIES = `{
  uuid: ent.uuid,
  name: ent.name,
  type: ent.type,
  createdAt: ent.createdAt,
  userId: ent.userId,
  workspaceId: ent.workspaceId,
  attributes: ent.attributes
}`;

export const COMPACTED_SESSION_NODE_PROPERTIES = `{
  uuid: cs.uuid,
  sessionId: cs.sessionId,
  summary: cs.summary,
  episodeCount: cs.episodeCount,
  startTime: cs.startTime,
  endTime: cs.endTime,
  createdAt: cs.createdAt,
  updatedAt: cs.updatedAt,
  confidence: cs.confidence,
  userId: cs.userId,
  workspaceId: cs.workspaceId,
  source: cs.source,
  compressionRatio: cs.compressionRatio,
  metadata: cs.metadata
}`;

/**
 * Entity types for the knowledge graph (10 types)
 * Only NAMED, SEARCHABLE entities - no generic vocabulary
 */
export const EntityTypes = [
  "Person",       // People: Sarah, John, Dr. Chen, Mike
  "Organization", // Companies/teams: Google, Red Planet, Design Team
  "Place",        // Locations: Bangalore, San Francisco, Office HQ
  "Event",        // Occurrences: React Conference, Q2 Planning, Sprint Review
  "Project",      // Work initiatives: CORE, MVP, Website Redesign
  "Task",         // Tracked items: CORE-123, Issue #456, TODO-789
  "Technology",   // Tools/frameworks: TypeScript, PostgreSQL, React, Neo4j
  "Product",      // Products/services: iPhone, Slack, ChatGPT, Figma
  "Standard",     // Methodologies: OAuth 2.0, REST API, Agile, SOLID
  "Concept",      // Abstract topics: Fat Loss, Code Review, Search Pipeline
  "Predicate",    // Relationships: "works at", "lives in", "manages"
] as const;

export type EntityType = (typeof EntityTypes)[number];


/**
 * Interface for entity node in the reified knowledge graph
 * Entities represent subjects, objects, or predicates in statements
 */
export interface EntityNode {
  uuid: string;
  name: string;
  type?: EntityType; // Optional type - can be inferred from statements
  nameEmbedding?: number[];
  attributes?: Record<string, any>;
  createdAt: Date;
  userId: string;
  workspaceId?: string;
}

/**
 * Statement aspects for classification
 * These are the types of knowledge a statement can represent
 *
 * Categories:
 * 1. Identity - Who they are (slow-changing): role, location, affiliation
 * 2. Knowledge - What they know: expertise, skills, understanding
 * 3. Belief - Why they think that way: values, opinions, reasoning
 * 4. Preference - How they want things: likes, dislikes, style choices
 * 5. Action - What they do: observable behaviors, habits, practices
 * 6. Goal - What they want to achieve: future targets, aims
 * 7. Directive - Rules and automation: always do X, notify when Y, remind me to Z
 * 8. Decision - Choices made, conclusions reached
 * 9. Event - Specific occurrences with timestamps
 * 10. Problem - Blockers, issues, challenges
 * 11. Relationship - Connections between people
 */
export const StatementAspects = [
  "Identity",     // Who they are - role, location, affiliation (slow-changing)
  "Knowledge",    // What they know - expertise, skills, understanding
  "Belief",       // Why they think that way - values, opinions, reasoning
  "Preference",   // How they want things - likes, dislikes, style choices
  "Action",       // What they do - observable behaviors, habits, practices
  "Goal",         // What they want to achieve - future targets, aims
  "Directive",    // Rules and automation - always do X, notify when Y, remind me to Z
  "Decision",     // Choices made, conclusions reached
  "Event",        // Specific occurrences with timestamps
  "Problem",      // Blockers, issues, challenges
  "Relationship", // Connections between people
] as const;

export type StatementAspect = (typeof StatementAspects)[number];

/**
 * Interface for statement node in the reified knowledge graph
 * Statements are first-class objects representing facts with temporal properties
 */
export interface StatementNode {
  uuid: string;
  fact: string;
  factEmbedding: number[];
  createdAt: Date;
  validAt: Date;
  invalidAt: Date | null;
  invalidatedBy?: string; // UUID of the episode that invalidated this statement
  attributes: Record<string, any>;
  userId: string;
  workspaceId?: string;
  labelIds?: string[];
  aspect?: StatementAspect | null; // Classification of the statement type
  recallCount?: { low: number; high: number };
  provenanceCount?: number;
}

/**
 * Interface for a triple in the reified knowledge graph
 * A triple connects a subject, predicate, object via a statement node
 * and maintains provenance information
 */
export interface Triple {
  statement: StatementNode;
  subject: EntityNode;
  predicate: EntityNode;
  object: EntityNode;
  provenance: EpisodicNode;
}

export enum EpisodeTypeEnum {
  CONVERSATION = "CONVERSATION",
  DOCUMENT = "DOCUMENT",
}

export const EpisodeType = {
  CONVERSATION: "CONVERSATION",
  DOCUMENT: "DOCUMENT",
  IMAGE: "IMAGE",
};

export type EpisodeType = (typeof EpisodeType)[keyof typeof EpisodeType];

export type AddEpisodeParams = {
  episodeBody: string;
  originalEpisodeBody: string;
  referenceTime: Date;
  metadata?: Record<string, any>;
  source: string;
  userId: string;
  workspaceId?: string;
  userName?: string; // User's display name for user-centric extraction
  labelIds?: string[];
  sessionId: string;
  queueId: string;
  type?: EpisodeType;

  // Chunking metadata
  chunkIndex?: number;
  totalChunks?: number;

  // Version tracking (only set on first chunk)
  version?: number;
  contentHash?: string;
  previousVersionSessionId?: string;
  chunkHashes?: string[];

  // Episode UUID (set in preprocessing, episode already saved to graph)
  episodeUuid?: string;
};

export type AddEpisodeResult = {
  episodeUuid: string | null;
  type: EpisodeType;
  statementsCreated: number;
  processingTimeMs: number;
  tokenUsage?: {
    high: { input: number; output: number; total: number };
    low: { input: number; output: number; total: number };
  };
  totalChunks?: number;
  currentChunk?: number;
};

export interface ExtractedTripleData {
  source: string;
  sourceType?: string; // Optional - can be inferred from statements
  predicate: string;
  target: string;
  targetType?: string; // Optional - can be inferred from statements
  fact: string;
  aspect?: StatementAspect | null; // Classification of the statement type
  attributes?: Record<string, any>;
}

export interface CompactedSessionNode {
  uuid: string;
  sessionId: string;
  summary: string;
  summaryEmbedding?: number[];
  episodeCount: number;
  startTime: Date;
  endTime: Date;
  createdAt: Date;
  updatedAt?: Date;
  confidence: number;
  userId: string;
  workspaceId?: string;
  source: string;
  compressionRatio?: number;
  metadata?: Record<string, any>;
}

/**
 * Interface for space node - a collection of related episodes
 * Spaces help organize memory by topics, projects, or contexts
 */
export interface SpaceNode {
  uuid: string;
  name: string;
  description: string;
  userId: string;
  workspaceId?: string;
  createdAt: Date;
  updatedAt: Date;
  isActive: boolean;
  contextCount?: number; // Number of episodes assigned to this space
  type?: string; // Space type (e.g., 'classification')
  summaryStructure?: string; // Optional structure for space summaries
}

/**
 * Result type for space deletion operations
 */
export interface SpaceDeletionResult {
  deleted: boolean;
  statementsUpdated: number;
  error?: string;
}

/**
 * Result type for space assignment operations
 */
export interface SpaceAssignmentResult {
  success: boolean;
  statementsUpdated: number;
  error?: string;
}

/**
 * Adjacent episode chunks result
 */
export interface AdjacentChunks {
  matchedChunk: EpisodicNode;
  previousChunk?: EpisodicNode;
  nextChunk?: EpisodicNode;
}
