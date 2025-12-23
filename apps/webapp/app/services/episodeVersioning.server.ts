import { EpisodeType, type EpisodicNode } from "@core/types";
import { logger } from "./logger.service";
import { EpisodeChunker } from "./episodeChunker.server";
import { ProviderFactory } from "@core/providers";
import { prisma } from "~/db.server";
import { Document } from "@prisma/client";

/**
 * Version information for an episode session
 */
export interface VersionedEpisodeInfo {
  isNewSession: boolean;
  document: Document | null;
  newVersion: number;
  previousVersionSessionId: string | null;
  hasContentChanged: boolean;
  chunkLevelChanges: {
    changedChunkIndices: number[];
    changePercentage: number;
    totalChunks: number;
  };
}

/**
 * Episode-level versioning service
 * Handles version detection and tracking for both documents and conversations
 */
export class EpisodeVersioningService {
  /**
   * Analyze version changes for a session
   * Compares content and chunk hashes to detect changes
   */
  async analyzeVersionChanges(
    sessionId: string,
    userId: string,
    newContent: string,
    newChunkHashes: string[],
    type: EpisodeType,
  ): Promise<VersionedEpisodeInfo> {
    // Only documents support versioning by default
    // Conversations are typically append-only
    if (type !== EpisodeType.DOCUMENT) {
      return this.createNewSessionInfo(newChunkHashes.length);
    }

    const document = await prisma.document.findUnique({
      where: {
        id: sessionId,
      },
    });

    // If no existing version, this is a new session
    if (!document) {
      return this.createNewSessionInfo(newChunkHashes.length);
    }

    // Compare content hashes
    const newContentHash = this.generateContentHash(newContent);
    const existingContentHash = document.contentHash;

    // If content hash unchanged, no processing needed
    if (newContentHash === existingContentHash) {
      return {
        isNewSession: false,
        document,
        newVersion: document.version || 1,
        previousVersionSessionId: document.id,
        hasContentChanged: false,
        chunkLevelChanges: {
          changedChunkIndices: [],
          changePercentage: 0,
          totalChunks: newChunkHashes.length,
        },
      };
    }

    // Content changed - compare chunk hashes for differential detection
    const existingChunkHashes = document.chunkHashes || [];
    const chunkComparison = EpisodeChunker.compareChunkHashes(
      existingChunkHashes,
      newChunkHashes,
    );

    const newVersion = (document.version || 1) + 1;

    logger.info(
      `Version change detected for session ${sessionId}: v${document.version} → v${newVersion}`,
      {
        changedChunks: chunkComparison.changedIndices.length,
        totalChunks: newChunkHashes.length,
        changePercentage: chunkComparison.changePercentage.toFixed(1),
      },
    );

    return {
      isNewSession: false,
      document,
      newVersion,
      previousVersionSessionId: document.id,
      hasContentChanged: true,
      chunkLevelChanges: {
        changedChunkIndices: chunkComparison.changedIndices,
        changePercentage: chunkComparison.changePercentage,
        totalChunks: newChunkHashes.length,
      },
    };
  }

  /**
   * Create new session info (no existing version)
   */
  private createNewSessionInfo(totalChunks: number): VersionedEpisodeInfo {
    return {
      isNewSession: true,
      document: null,
      newVersion: 1,
      previousVersionSessionId: null,
      hasContentChanged: true,
      chunkLevelChanges: {
        changedChunkIndices: Array.from({ length: totalChunks }, (_, i) => i),
        changePercentage: 100,
        totalChunks,
      },
    };
  }

  /**
   * Generate content hash
   */
  private generateContentHash(content: string): string {
    const crypto = require("crypto");
    return crypto.createHash("sha256").update(content, "utf8").digest("hex");
  }
}
