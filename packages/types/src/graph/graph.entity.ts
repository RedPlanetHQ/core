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
  labels: string[];
  userId: string;
  space?: string;
  sessionId?: string;
  recallCount?: number;
  chunkIndex?: number; // Index of this chunk within the document
  spaceIds?: string[];
  documentId?: string;
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
  createdAt: e.createdAt,
  userId: e.userId,
  sessionId: e.sessionId,
  spaceIds: e.spaceIds,
  validAt: e.validAt,
  recallCount: e.recallCount,
  chunkIndex: e.chunkIndex,
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
  space?: string; // Legacy field - deprecated in favor of spaceIds
  spaceIds?: string[]; // Array of space UUIDs this statement belongs to
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
  spaceId?: string;
  sessionId?: string;
  type?: EpisodeType;
  documentId?: string;
};

export type AddEpisodeResult = {
  episodeUuid: string;
  nodesCreated: number;
  statementsCreated: number;
  processingTimeMs: number;
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

