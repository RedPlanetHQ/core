import { encode } from "gpt-tokenizer";
import { EpisodeChunker, type ChunkedEpisode } from "./episodeChunker.server";
import type { DocumentNode, EpisodicNode } from "@core/types";

export interface DifferentialDecision {
  shouldUseDifferential: boolean;
  strategy: "full_reingest" | "chunk_level_diff" | "new_document" | "skip_processing";
  reason: string;
  changedChunkIndices: number[];
  changePercentage: number;
  documentSizeTokens: number;
}

export interface ChunkComparison {
  chunkIndex: number;
  hasChanged: boolean;
  oldHash?: string;
  newHash: string;
  semanticSimilarity?: number;
}

/**
 * Service for implementing differential document processing logic
 * Determines when to use differential vs full re-ingestion based on
 * document size and change percentage thresholds
 */
export class DocumentDifferentialService {
  // Threshold constants based on our enhanced approach
  private readonly SMALL_DOC_THRESHOLD = 5 * 1000; // 5K tokens
  private readonly MEDIUM_DOC_THRESHOLD = 50 * 1000; // 50K tokens
  
  // Change percentage thresholds
  private readonly SMALL_CHANGE_THRESHOLD = 20; // 20%
  private readonly MEDIUM_CHANGE_THRESHOLD = 30; // 30%

  /**
   * Analyze whether to use differential processing for a document update
   */
  async analyzeDifferentialNeed(
    newContent: string,
    existingDocument: EpisodicNode | null,
    newChunkedDocument: ChunkedEpisode,
  ): Promise<DifferentialDecision> {
    // If no existing document, it's a new document
    if (!existingDocument) {
      return {
        shouldUseDifferential: false,
        strategy: "new_document",
        reason: "No existing document found",
        changedChunkIndices: [],
        changePercentage: 100,
        documentSizeTokens: encode(newContent).length,
      };
    }

    const documentSizeTokens = encode(newContent).length;
    
    // Compare chunk hashes to identify changes
    const chunkComparison = EpisodeChunker.compareChunkHashes(
      existingDocument.chunkHashes || [],
      newChunkedDocument.chunkHashes,
    );

    const { changedIndices, changePercentage } = chunkComparison;

    // Apply threshold-based decision matrix
    const decision = this.applyThresholdDecision(
      documentSizeTokens,
      changePercentage,
    );

    return {
      ...decision,
      changedChunkIndices: changedIndices,
      changePercentage,
      documentSizeTokens,
    };
  }

  /**
   * Apply threshold-based decision matrix
   */
  private applyThresholdDecision(
    documentSizeTokens: number,
    changePercentage: number,
  ): Pick<DifferentialDecision, "shouldUseDifferential" | "strategy" | "reason"> {
    // Small documents: always full re-ingest (cheap)
    if (documentSizeTokens < this.SMALL_DOC_THRESHOLD) {
      return {
        shouldUseDifferential: false,
        strategy: "full_reingest",
        reason: `Document too small (${documentSizeTokens} tokens < ${this.SMALL_DOC_THRESHOLD})`,
      };
    }

    // Medium documents (5-50K tokens)
    if (documentSizeTokens < this.MEDIUM_DOC_THRESHOLD) {
      if (changePercentage < this.SMALL_CHANGE_THRESHOLD) {
        return {
          shouldUseDifferential: true,
          strategy: "chunk_level_diff",
          reason: `Medium document with small changes (${changePercentage.toFixed(1)}% < ${this.SMALL_CHANGE_THRESHOLD}%)`,
        };
      } else {
        return {
          shouldUseDifferential: false,
          strategy: "full_reingest",
          reason: `Medium document with large changes (${changePercentage.toFixed(1)}% >= ${this.SMALL_CHANGE_THRESHOLD}%)`,
        };
      }
    }

    // Large documents (>50K tokens)
    if (changePercentage < this.MEDIUM_CHANGE_THRESHOLD) {
      return {
        shouldUseDifferential: true,
        strategy: "chunk_level_diff",
        reason: `Large document with moderate changes (${changePercentage.toFixed(1)}% < ${this.MEDIUM_CHANGE_THRESHOLD}%)`,
      };
    } else {
      return {
        shouldUseDifferential: false,
        strategy: "full_reingest",
        reason: `Large document with extensive changes (${changePercentage.toFixed(1)}% >= ${this.MEDIUM_CHANGE_THRESHOLD}%)`,
      };
    }
  }

  /**
   * Get detailed chunk comparison for differential processing
   */
  getChunkComparisons(
    existingDocument: DocumentNode,
    newChunkedDocument: ChunkedEpisode,
  ): ChunkComparison[] {
    const oldHashes = existingDocument.chunkHashes || [];
    const newHashes = newChunkedDocument.chunkHashes;
    const maxLength = Math.max(oldHashes.length, newHashes.length);
    
    const comparisons: ChunkComparison[] = [];

    for (let i = 0; i < maxLength; i++) {
      const oldHash = oldHashes[i];
      const newHash = newHashes[i];
      
      comparisons.push({
        chunkIndex: i,
        hasChanged: oldHash !== newHash,
        oldHash,
        newHash: newHash || "", // Handle case where new doc has fewer chunks
      });
    }

    return comparisons;
  }

  /**
   * Filter chunks that need re-processing
   */
  getChunksNeedingReprocessing(
    chunkComparisons: ChunkComparison[],
  ): number[] {
    return chunkComparisons
      .filter(comparison => comparison.hasChanged)
      .map(comparison => comparison.chunkIndex);
  }

  /**
   * Calculate processing cost savings estimate
   */
  calculateCostSavings(
    totalChunks: number,
    changedChunks: number,
  ): {
    chunksToProcess: number;
    chunksSkipped: number;
    estimatedSavingsPercentage: number;
  } {
    const chunksSkipped = totalChunks - changedChunks;
    const estimatedSavingsPercentage = totalChunks > 0 
      ? (chunksSkipped / totalChunks) * 100 
      : 0;

    return {
      chunksToProcess: changedChunks,
      chunksSkipped,
      estimatedSavingsPercentage,
    };
  }
}