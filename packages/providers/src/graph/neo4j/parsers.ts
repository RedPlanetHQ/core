/**
 * Parsing functions to convert raw Neo4j records to typed domain objects
 */

import type {
  EntityNode,
  EpisodicNode,
  StatementNode,
  SpaceNode,
  CompactedSessionNode,
} from "@core/types";

export function parseEntityNode(raw: any): EntityNode {
  return {
    uuid: raw.uuid,
    name: raw.name,
    type: raw.type || null,
    nameEmbedding: raw.nameEmbedding || [],
    attributes: raw.attributes
      ? typeof raw.attributes === "string"
        ? JSON.parse(raw.attributes)
        : raw.attributes
      : {},
    createdAt: new Date(raw.createdAt),
    userId: raw.userId,
  };
}

export function parseEpisodicNode(raw: any): EpisodicNode {
  return {
    uuid: raw.uuid,
    content: raw.content,
    originalContent: raw.originalContent,
    contentEmbedding: raw.contentEmbedding,
    metadata: raw.metadata || {},
    source: raw.source,
    createdAt: new Date(raw.createdAt),
    validAt: new Date(raw.validAt),
    labelIds: raw.labelIds || [],
    userId: raw.userId,
    sessionId: raw.sessionId,
    queueId: raw.queueId,
    type: raw.type,
    chunkIndex: raw.chunkIndex,
    totalChunks: raw.totalChunks,
    version: raw.version,
    contentHash: raw.contentHash,
    previousVersionSessionId: raw.previousVersionSessionId,
    chunkHashes: raw.chunkHashes,
    recallCount: raw.recallCount,
  };
}

export function parseStatementNode(raw: any): StatementNode {
  return {
    uuid: raw.uuid,
    fact: raw.fact,
    factEmbedding: raw.factEmbedding || [],
    createdAt: new Date(raw.createdAt),
    validAt: new Date(raw.validAt),
    invalidAt: raw.invalidAt ? new Date(raw.invalidAt) : null,
    invalidatedBy: raw.invalidatedBy,
    attributes: raw.attributes ? JSON.parse(raw.attributes) : {},
    userId: raw.userId,
    labelIds: raw.labelIds || [],
    aspect: raw.aspect || null,
    recallCount: raw.recallCount,
    provenanceCount: raw.provenanceCount,
  };
}

export function parseSpaceNode(raw: any): SpaceNode {
  return {
    uuid: raw.uuid,
    name: raw.name,
    description: raw.description,
    userId: raw.userId,
    createdAt: new Date(raw.createdAt),
    updatedAt: new Date(raw.updatedAt),
    isActive: raw.isActive,
    contextCount: raw.contextCount,
    type: raw.type,
    summaryStructure: raw.summaryStructure,
  };
}

export function parseCompactedSessionNode(raw: any): CompactedSessionNode {
  return {
    uuid: raw.uuid,
    sessionId: raw.sessionId,
    summary: raw.summary,
    summaryEmbedding: raw.summaryEmbedding,
    episodeCount: raw.episodeCount,
    startTime: new Date(raw.startTime),
    endTime: new Date(raw.endTime),
    createdAt: new Date(raw.createdAt),
    updatedAt: raw.updatedAt ? new Date(raw.updatedAt) : undefined,
    confidence: raw.confidence,
    userId: raw.userId,
    source: raw.source,
    compressionRatio: raw.compressionRatio,
    metadata: raw.metadata,
  };
}
