/**
 * Type definitions for Neo4j provider
 */

export interface Neo4jLogger {
  info: (message: string, meta?: any) => void;
  error: (message: string, meta?: any) => void;
}

export interface Neo4jConfig {
  uri: string;
  username: string;
  password: string;
  maxConnectionPoolSize?: number;
  embeddingModelSize?: string;
  logger?: Neo4jLogger;
}

export interface RawTriplet {
  sourceNode: {
    uuid: string;
    labels: string[];
    attributes: Record<string, any>;
    clusterId?: string;
    createdAt: string;
  };
  edge: {
    uuid: string;
    type: string;
    source_node_uuid: string;
    target_node_uuid: string;
    attributes: Record<string, any>;
    createdAt: string;
  };
  targetNode: {
    uuid: string;
    labels: string[];
    attributes: Record<string, any>;
    clusterId?: string;
    createdAt: string;
  };
}

export const EPISODIC_NODE_PROPERTIES = `{
  uuid: e.uuid,
  content: e.content,
  originalContent: e.originalContent,
  source: e.source,
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
  chunkHashes: e.chunkHashes
}`;

export const STATEMENT_NODE_PROPERTIES = `{
  uuid: s.uuid,
  fact: s.fact,
  createdAt: s.createdAt,
  userId: s.userId,
  validAt: s.validAt,
  invalidAt: s.invalidAt,
  invalidatedBy: s.invalidatedBy,
  recallCount: s.recallCount,
  provenanceCount: s.provenanceCount
}`;

export const ENTITY_NODE_PROPERTIES = `{
  uuid: ent.uuid,
  name: ent.name,
  createdAt: ent.createdAt,
  userId: ent.userId
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
