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

  // Grouping and chunking
  sessionId: string;  // Required - groups chunks together (replaces documentId)
  queueId?: string;   // Ingestion queue ID - useful for grouping chunks of same message/document ingestion
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
  chunkHashes: e.chunkHashes,
  documentId: e.documentId
}`;

export const STATEMENT_NODE_PROPERTIES = `{
  uuid: s.uuid,
  fact: s.fact,
  createdAt: s.createdAt,
  userId: s.userId,
  validAt: s.validAt,
  invalidAt: s.invalidAt,
  invalidatedBy: s.invalidatedBy,
  attributes: s.attributes,
  recallCount: s.recallCount,
  provenanceCount: s.provenanceCount
}`;

export const ENTITY_NODE_PROPERTIES = `{
  uuid: ent.uuid,
  name: ent.name,
  createdAt: ent.createdAt,
  userId: ent.userId,
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
  source: cs.source,
  compressionRatio: cs.compressionRatio,
  metadata: cs.metadata
}`;

/**
 * Interface for entity node in the reified knowledge graph
 * Entities represent subjects, objects, or predicates in statements
 */
export interface EntityNode {
  uuid: string;
  name: string;
  type?: string; // Optional type - can be inferred from statements
  nameEmbedding?: number[];
  attributes?: Record<string, any>;
  createdAt: Date;
  userId: string;
}

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
  labelIds?: string[];
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
  referenceTime: Date;
  metadata?: Record<string, any>;
  source: string;
  userId: string;
  labelIds?: string[];
  sessionId: string;
  queueId?: string;
  type?: EpisodeType;

  // Chunking metadata
  chunkIndex?: number;
  totalChunks?: number;

  // Version tracking (only set on first chunk)
  version?: number;
  contentHash?: string;
  previousVersionSessionId?: string;
  chunkHashes?: string[];

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
  source: string;
  compressionRatio?: number;
  metadata?: Record<string, any>;
}
