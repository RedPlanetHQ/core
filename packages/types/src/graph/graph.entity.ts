export enum EpisodeType {
  Conversation = "CONVERSATION",
  Text = "TEXT",
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
}

/**
 * Interface for entity node in the reified knowledge graph
 * Entities represent subjects, objects, or predicates in statements
 */
export interface EntityNode {
  uuid: string;
  name: string;
  type: string; // Single type - either from presets or custom
  attributes: Record<string, any>;
  nameEmbedding: number[];
  typeEmbedding: number[];
  createdAt: Date;
  userId: string;
  space?: string;
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
  attributes: Record<string, any>;
  userId: string;
  space?: string;
  recallCount?: number;
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

export type AddEpisodeParams = {
  episodeBody: string;
  referenceTime: Date;
  metadata: Record<string, any>;
  source: string;
  userId: string;
  spaceId?: string;
  sessionId?: string;
};

export type AddEpisodeResult = {
  episodeUuid: string;
  nodesCreated: number;
  statementsCreated: number;
  processingTimeMs: number;
};

export interface ExtractedTripleData {
  source: string;
  sourceType: string;
  predicate: string;
  target: string;
  targetType: string;
  fact: string;
  attributes?: Record<string, any>;
}
