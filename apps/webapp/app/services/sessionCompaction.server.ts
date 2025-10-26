import { logger } from "~/services/logger.service";
import {
  getCompactedSessionBySessionId,
  getCompactionStats,
  getSessionEpisodes,
  type CompactedSessionNode,
} from "~/services/graphModels/compactedSession";
import { enqueueSessionCompaction } from "~/lib/queue-adapter.server";

/**
 * Configuration for session compaction
 */
export const COMPACTION_CONFIG = {
  minEpisodesForCompaction: 5, // Minimum episodes to trigger initial compaction
  compactionThreshold: 1, // Trigger update after N new episodes
  autoCompactionEnabled: true, // Enable automatic compaction
};

/**
 * SessionCompactionService - Manages session compaction lifecycle
 */
export class SessionCompactionService {
  /**
   * Check if a session should be compacted
   */
  async shouldCompact(sessionId: string, userId: string): Promise<{
    shouldCompact: boolean;
    reason: string;
    episodeCount?: number;
    newEpisodeCount?: number;
  }> {
    try {
      // Get existing compact
      const existingCompact = await getCompactedSessionBySessionId(sessionId, userId);

      if (!existingCompact) {
        // No compact exists, check if we have enough episodes
        const episodeCount = await this.getSessionEpisodeCount(sessionId, userId);

        if (episodeCount >= COMPACTION_CONFIG.minEpisodesForCompaction) {
          return {
            shouldCompact: true,
            reason: "initial_compaction",
            episodeCount,
          };
        }

        return {
          shouldCompact: false,
          reason: "insufficient_episodes",
          episodeCount,
        };
      }

      // Compact exists, check if we have enough new episodes
      const newEpisodeCount = await this.getNewEpisodeCount(
        sessionId,
        userId,
        existingCompact.endTime
      );

      if (newEpisodeCount >= COMPACTION_CONFIG.compactionThreshold) {
        return {
          shouldCompact: true,
          reason: "update_compaction",
          newEpisodeCount,
        };
      }

      return {
        shouldCompact: false,
        reason: "insufficient_new_episodes",
        newEpisodeCount,
      };
    } catch (error) {
      logger.error(`Error checking if session should compact`, {
        sessionId,
        userId,
        error: error instanceof Error ? error.message : String(error),
      });

      return {
        shouldCompact: false,
        reason: "error",
      };
    }
  }

  /**
   * Get total episode count for a session
   */
  private async getSessionEpisodeCount(
    sessionId: string,
    userId: string
  ): Promise<number> {
    const episodes = await getSessionEpisodes(sessionId, userId);
    return episodes.length;
  }

  /**
   * Get count of new episodes since last compaction
   */
  private async getNewEpisodeCount(
    sessionId: string,
    userId: string,
    afterTime: Date
  ): Promise<number> {
    const episodes = await getSessionEpisodes(sessionId, userId, afterTime);
    return episodes.length;
  }

  /**
   * Trigger compaction for a session
   */
  async triggerCompaction(
    sessionId: string,
    userId: string,
    source: string,
    triggerSource: "auto" | "manual" | "threshold" = "auto"
  ): Promise<{ success: boolean; taskId?: string; error?: string }> {
    try {
      // Check if compaction should be triggered
      const check = await this.shouldCompact(sessionId, userId);

      if (!check.shouldCompact) {
        logger.info(`Compaction not needed`, {
          sessionId,
          userId,
          reason: check.reason,
        });

        return {
          success: false,
          error: `Compaction not needed: ${check.reason}`,
        };
      }

      // Trigger the compaction task
      logger.info(`Triggering session compaction`, {
        sessionId,
        userId,
        source,
        triggerSource,
        reason: check.reason,
      });

      const handle = await enqueueSessionCompaction({
        userId,
        sessionId,
        source,
        triggerSource,
      });

      logger.info(`Session compaction triggered`, {
        sessionId,
        userId,
        taskId: handle.id,
      });

      return {
        success: true,
        taskId: handle.id,
      };
    } catch (error) {
      logger.error(`Failed to trigger compaction`, {
        sessionId,
        userId,
        error: error instanceof Error ? error.message : String(error),
      });

      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  /**
   * Get compacted session for recall
   */
  async getCompactForRecall(
    sessionId: string,
    userId: string
  ): Promise<CompactedSessionNode | null> {
    try {
      return await getCompactedSessionBySessionId(sessionId, userId);
    } catch (error) {
      logger.error(`Error fetching compact for recall`, {
        sessionId,
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  /**
   * Get compaction statistics for a user
   */
  async getStats(userId: string): Promise<{
    totalCompacts: number;
    totalEpisodes: number;
    averageCompressionRatio: number;
    mostRecentCompaction: Date | null;
  }> {
    try {
      return await getCompactionStats(userId);
    } catch (error) {
      logger.error(`Error fetching compaction stats`, {
        userId,
        error: error instanceof Error ? error.message : String(error),
      });

      return {
        totalCompacts: 0,
        totalEpisodes: 0,
        averageCompressionRatio: 0,
        mostRecentCompaction: null,
      };
    }
  }

  /**
   * Auto-trigger compaction after episode ingestion
   * Called from ingestion pipeline
   */
  async autoTriggerAfterIngestion(
    sessionId: string | null | undefined,
    userId: string,
    source: string
  ): Promise<void> {
    // Skip if no sessionId or auto-compaction disabled
    if (!sessionId || !COMPACTION_CONFIG.autoCompactionEnabled) {
      return;
    }

    try {
      const check = await this.shouldCompact(sessionId, userId);

      if (check.shouldCompact) {
        logger.info(`Auto-triggering compaction after ingestion`, {
          sessionId,
          userId,
          reason: check.reason,
        });

        // Trigger compaction asynchronously (don't wait)
        await this.triggerCompaction(sessionId, userId, source, "auto");
      }
    } catch (error) {
      // Log error but don't fail ingestion
      logger.error(`Error in auto-trigger compaction`, {
        sessionId,
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

// Singleton instance
export const sessionCompactionService = new SessionCompactionService();
