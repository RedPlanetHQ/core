import { task } from "@trigger.dev/sdk";
import { z } from "zod";
import { IngestionStatus } from "@core/database";
import { logger } from "~/services/logger.service";
import { prisma } from "../utils/prisma";
import { type IngestBodyRequest, ingestTask } from "./ingest";
import {
  estimateCreditsFromTokens,
  reserveCredits,
} from "~/services/billing.server";
import { countTokens } from "~/services/search/tokenBudget";

export const RetryNoCreditBodyRequest = z.object({
  workspaceId: z.string(),
});

// Register the Trigger.dev task to retry NO_CREDITS episodes
export const retryNoCreditsTask = task({
  id: "retry-no-credits-episodes",
  run: async (payload: z.infer<typeof RetryNoCreditBodyRequest>) => {
    try {
      logger.log(
        `Starting retry of NO_CREDITS episodes for workspace ${payload.workspaceId}`,
      );

      // Find all ingestion queue items with NO_CREDITS status for this workspace
      const noCreditItems = await prisma.ingestionQueue.findMany({
        where: {
          workspaceId: payload.workspaceId,
          status: IngestionStatus.NO_CREDITS,
        },
        orderBy: {
          createdAt: "asc", // Process oldest first
        },
        include: {
          workspace: true,
        },
      });

      if (noCreditItems.length === 0) {
        logger.log(
          `No NO_CREDITS episodes found for workspace ${payload.workspaceId}`,
        );
        return {
          success: true,
          message: "No episodes to retry",
          retriedCount: 0,
        };
      }

      logger.log(`Found ${noCreditItems.length} NO_CREDITS episodes to retry`);

      const results = {
        total: noCreditItems.length,
        retriggered: 0,
        failed: 0,
        errors: [] as Array<{ queueId: string; error: string }>,
      };

      // Process each item
      for (const item of noCreditItems) {
        try {
          const queueData = item.data as z.infer<typeof IngestBodyRequest>;

          // Reserve credits before retrying
          const inputTokens = countTokens(queueData.episodeBody);
          const estimatedCredits = estimateCreditsFromTokens(inputTokens);
          const reserved = await reserveCredits(
            payload.workspaceId,
            estimatedCredits,
          );

          if (reserved === 0) {
            logger.log(
              `Still insufficient credits for episode ${item.id}, skipping`,
            );
            results.failed++;
            results.errors.push({
              queueId: item.id,
              error: "Still insufficient credits",
            });
            continue;
          }

          // Reset status to PENDING and store reserved credits
          await prisma.ingestionQueue.update({
            where: { id: item.id },
            data: {
              status: IngestionStatus.PENDING,
              error: null,
              retryCount: item.retryCount + 1,
              output: { reservedCredits: reserved },
            },
          });

          // Trigger the ingestion task
          await ingestTask.trigger({
            body: queueData,
            userId: item.workspace?.userId as string,
            workspaceId: payload.workspaceId,
            queueId: item.id,
          });

          results.retriggered++;
          logger.log(
            `Successfully retriggered episode ${item.id} (retry #${item.retryCount + 1})`,
          );
        } catch (error: any) {
          results.failed++;
          results.errors.push({
            queueId: item.id,
            error: error.message,
          });
          logger.error(`Failed to retrigger episode ${item.id}:`, error);

          // Update the item to mark it as failed
          await prisma.ingestionQueue.update({
            where: { id: item.id },
            data: {
              status: IngestionStatus.FAILED,
              error: `Retry failed: ${error.message}`,
            },
          });
        }
      }

      logger.log(
        `Completed retry for workspace ${payload.workspaceId}. Retriggered: ${results.retriggered}, Failed: ${results.failed}`,
      );

      return {
        success: true,
        ...results,
      };
    } catch (err: any) {
      logger.error(
        `Error retrying NO_CREDITS episodes for workspace ${payload.workspaceId}:`,
        err,
      );
      return {
        success: false,
        error: err.message,
      };
    }
  },
});
