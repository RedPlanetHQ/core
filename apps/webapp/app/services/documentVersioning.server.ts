import crypto from "crypto";
import type { DocumentNode } from "@core/types";
import {
  findExistingDocument,
  getDocumentVersions,
} from "./graphModels/document";
import {
  DocumentChunker,
  type ChunkedDocument,
} from "./documentChunker.server";
import { KnowledgeGraphService } from "./knowledgeGraph.server";

export interface DocumentVersion {
  uuid: string;
  version: number;
  contentHash: string;
  chunkHashes: string[];
  createdAt: Date;
  validAt: Date;
  title: string;
  metadata: Record<string, any>;
}

export interface VersionedDocumentInfo {
  isNewDocument: boolean;
  existingDocument: DocumentNode | null;
  newVersion: number;
  previousVersionUuid: string | null;
  hasContentChanged: boolean;
  chunkLevelChanges: {
    changedChunkIndices: number[];
    changePercentage: number;
    totalChunks: number;
  };
}

/**
 * Service for managing document versions and coordinating differential ingestion
 * Integrates with the knowledge graph for semantic similarity checks
 */
export class DocumentVersioningService {
  private knowledgeGraphService: KnowledgeGraphService;

  constructor() {
    this.knowledgeGraphService = new KnowledgeGraphService();
  }

  /**
   * Prepare a new document version with proper versioning information
   */
  async prepareDocumentVersion(
    sessionId: string,
    userId: string,
    title: string,
    content: string,
    source: string,
    metadata: Record<string, any> = {},
  ): Promise<{
    documentNode: DocumentNode;
    versionInfo: VersionedDocumentInfo;
    chunkedDocument: ChunkedDocument;
  }> {
    // Find existing document for version comparison
    const existingDocument = await findExistingDocument(sessionId, userId);

    // Chunk the new document content
    const documentChunker = new DocumentChunker();
    const chunkedDocument = await documentChunker.chunkDocument(content, title);

    // Determine version information
    const versionInfo = this.analyzeVersionChanges(
      existingDocument,
      chunkedDocument,
    );

    // Create new document node
    const documentNode = this.createVersionedDocumentNode(
      sessionId,
      userId,
      title,
      content,
      source,
      metadata,
      versionInfo,
      chunkedDocument,
      existingDocument?.uuid,
    );

    return {
      documentNode,
      versionInfo,
      chunkedDocument,
    };
  }

  /**
   * Analyze changes between existing and new document versions
   */
  private analyzeVersionChanges(
    existingDocument: DocumentNode | null,
    newChunkedDocument: ChunkedDocument,
  ): VersionedDocumentInfo {
    if (!existingDocument) {
      return {
        isNewDocument: true,
        existingDocument: null,
        newVersion: 1,
        previousVersionUuid: null,
        hasContentChanged: true,
        chunkLevelChanges: {
          changedChunkIndices: [],
          changePercentage: 100,
          totalChunks: newChunkedDocument.totalChunks,
        },
      };
    }

    // Check if content has actually changed
    const hasContentChanged =
      existingDocument.contentHash !== newChunkedDocument.contentHash;

    if (!hasContentChanged) {
      return {
        isNewDocument: false,
        existingDocument,
        newVersion: existingDocument.version,
        previousVersionUuid: existingDocument.uuid,
        hasContentChanged: false,
        chunkLevelChanges: {
          changedChunkIndices: [],
          changePercentage: 0,
          totalChunks: newChunkedDocument.totalChunks,
        },
      };
    }

    // Analyze chunk-level changes
    const chunkComparison = DocumentChunker.compareChunkHashes(
      existingDocument.chunkHashes || [],
      newChunkedDocument.chunkHashes,
    );

    return {
      isNewDocument: false,
      existingDocument,
      newVersion: existingDocument.version + 1,
      previousVersionUuid: existingDocument.uuid,
      hasContentChanged: true,
      chunkLevelChanges: {
        changedChunkIndices: chunkComparison.changedIndices,
        changePercentage: chunkComparison.changePercentage,
        totalChunks: newChunkedDocument.totalChunks,
      },
    };
  }

  /**
   * Create a new versioned document node
   */
  private createVersionedDocumentNode(
    sessionId: string,
    userId: string,
    title: string,
    content: string,
    source: string,
    metadata: Record<string, any>,
    versionInfo: VersionedDocumentInfo,
    chunkedDocument: ChunkedDocument,
    existingDocumentUuid?: string ,
  ): DocumentNode {
    return {
      uuid: existingDocumentUuid || crypto.randomUUID(),
      title,
      originalContent: content,
      metadata: {
        ...metadata,
        chunkingStrategy: "semantic_sections",
        targetChunkSize: 12500,
        actualChunks: chunkedDocument.totalChunks,
      },
      source,
      userId,
      createdAt: new Date(),
      validAt: new Date(),
      totalChunks: chunkedDocument.totalChunks,
      version: versionInfo.newVersion,
      contentHash: chunkedDocument.contentHash,
      previousVersionUuid: versionInfo.previousVersionUuid || undefined,
      chunkHashes: chunkedDocument.chunkHashes,
      sessionId,
    };
  }

  /**
   * Get version history for a document
   */
  async getDocumentHistory(
    documentId: string,
    userId: string,
    limit: number = 10,
  ): Promise<DocumentVersion[]> {
    const versions = await getDocumentVersions(documentId, userId, limit);

    return versions.map((doc) => ({
      uuid: doc.uuid,
      version: doc.version,
      contentHash: doc.contentHash,
      chunkHashes: doc.chunkHashes || [],
      createdAt: doc.createdAt,
      validAt: doc.validAt,
      title: doc.title,
      metadata: doc.metadata,
    }));
  }

  /**
   * Check if statements should be invalidated based on semantic similarity
   * This implements the semantic similarity gate (>0.85 threshold)
   */
  async checkStatementInvalidation(
    oldChunkContent: string,
    newChunkContent: string,
    threshold: number = 0.85,
  ): Promise<{
    shouldInvalidate: boolean;
    semanticSimilarity: number;
  }> {
    try {
      // Generate embeddings for both chunks
      const [oldEmbedding, newEmbedding] = await Promise.all([
        this.knowledgeGraphService.getEmbedding(oldChunkContent),
        this.knowledgeGraphService.getEmbedding(newChunkContent),
      ]);

      // Calculate cosine similarity
      const similarity = this.calculateCosineSimilarity(
        oldEmbedding,
        newEmbedding,
      );

      // If similarity is below threshold, invalidate old statements
      const shouldInvalidate = similarity < threshold;

      return {
        shouldInvalidate,
        semanticSimilarity: similarity,
      };
    } catch (error) {
      console.error("Error checking statement invalidation:", error);
      // On error, be conservative and invalidate
      return {
        shouldInvalidate: true,
        semanticSimilarity: 0,
      };
    }
  }

  /**
   * Calculate cosine similarity between two embedding vectors
   */
  private calculateCosineSimilarity(vecA: number[], vecB: number[]): number {
    if (vecA.length !== vecB.length) {
      throw new Error("Vector dimensions must match");
    }

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < vecA.length; i++) {
      dotProduct += vecA[i] * vecB[i];
      normA += vecA[i] * vecA[i];
      normB += vecB[i] * vecB[i];
    }

    normA = Math.sqrt(normA);
    normB = Math.sqrt(normB);

    if (normA === 0 || normB === 0) {
      return 0;
    }

    return dotProduct / (normA * normB);
  }

  /**
   * Generate a differential processing report
   */
  generateDifferentialReport(
    versionInfo: VersionedDocumentInfo,
    processingStats: {
      chunksProcessed: number;
      chunksSkipped: number;
      statementsCreated: number;
      statementsInvalidated: number;
      processingTimeMs: number;
    },
  ): {
    summary: string;
    metrics: Record<string, any>;
  } {
    const totalChunks = versionInfo.chunkLevelChanges.totalChunks;
    const changePercentage = versionInfo.chunkLevelChanges.changePercentage;
    const savingsPercentage =
      totalChunks > 0 ? (processingStats.chunksSkipped / totalChunks) * 100 : 0;

    return {
      summary: `Document v${versionInfo.newVersion}: ${changePercentage.toFixed(1)}% changed, ${savingsPercentage.toFixed(1)}% processing saved`,
      metrics: {
        version: versionInfo.newVersion,
        isNewDocument: versionInfo.isNewDocument,
        totalChunks,
        chunksChanged: processingStats.chunksProcessed,
        chunksSkipped: processingStats.chunksSkipped,
        changePercentage: changePercentage,
        processingTimeMs: processingStats.processingTimeMs,
        statementsCreated: processingStats.statementsCreated,
        statementsInvalidated: processingStats.statementsInvalidated,
        estimatedCostSavings: savingsPercentage,
      },
    };
  }
}
