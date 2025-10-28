import { exec } from "child_process";
import { promisify } from "util";
import { identifySpacesForTopics } from "~/jobs/spaces/space-identification.logic";
import { assignEpisodesToSpace } from "~/services/graphModels/space";
import { logger } from "~/services/logger.service";
import { SpaceService } from "~/services/space.server";
import { prisma } from "~/trigger/utils/prisma";

const execAsync = promisify(exec);

export interface TopicAnalysisPayload {
  userId: string;
  workspaceId: string;
  minTopicSize?: number;
  nrTopics?: number;
}

export interface TopicAnalysisResult {
  topics: {
    [topicId: string]: {
      keywords: string[];
      episodeIds: string[];
    };
  };
}

/**
 * Run BERT analysis using exec (for BullMQ/Docker)
 */
async function runBertWithExec(
  userId: string,
  minTopicSize: number,
  nrTopics?: number,
): Promise<string> {
  let command = `python3 /core/apps/webapp/app/bert/main.py ${userId} --json`;

  if (minTopicSize) {
    command += ` --min-topic-size ${minTopicSize}`;
  }

  if (nrTopics) {
    command += ` --nr-topics ${nrTopics}`;
  }

  console.log(`[BERT Topic Analysis] Executing: ${command}`);

  const { stdout, stderr } = await execAsync(command, {
    timeout: 300000, // 5 minutes
    maxBuffer: 10 * 1024 * 1024, // 10MB buffer for large outputs
  });

  if (stderr) {
    console.warn(`[BERT Topic Analysis] Warnings:`, stderr);
  }

  return stdout;
}

/**
 * Process BERT topic analysis on user's episodes
 * This is the common logic shared between Trigger.dev and BullMQ
 *
 * NOTE: This function does NOT update workspace.metadata.lastTopicAnalysisAt
 * That should be done by the caller BEFORE enqueueing this job to prevent
 * duplicate analyses from racing conditions.
 */
export async function processTopicAnalysis(
  payload: TopicAnalysisPayload,
  enqueueSpaceSummary?: (params: {
    spaceId: string;
    userId: string;
  }) => Promise<any>,
  pythonRunner?: (
    userId: string,
    minTopicSize: number,
    nrTopics?: number,
  ) => Promise<string>,
): Promise<TopicAnalysisResult> {
  const { userId, workspaceId, minTopicSize = 10, nrTopics } = payload;

  console.log(`[BERT Topic Analysis] Starting analysis for user: ${userId}`);
  console.log(
    `[BERT Topic Analysis] Parameters: minTopicSize=${minTopicSize}, nrTopics=${nrTopics || "auto"}`,
  );

  try {
    const startTime = Date.now();

    // Run BERT analysis using provided runner or default exec
    const runner = pythonRunner || runBertWithExec;
    const stdout = await runner(userId, minTopicSize, nrTopics);

    const duration = Date.now() - startTime;
    console.log(`[BERT Topic Analysis] Completed in ${duration}ms`);

    // Parse the JSON output
    const result: TopicAnalysisResult = JSON.parse(stdout);

    // Log summary
    const topicCount = Object.keys(result.topics).length;
    const totalEpisodes = Object.values(result.topics).reduce(
      (sum, topic) => sum + topic.episodeIds.length,
      0,
    );

    console.log(
      `[BERT Topic Analysis] Found ${topicCount} topics covering ${totalEpisodes} episodes`,
    );

    // Step 2: Identify spaces for topics using LLM
    try {
      logger.info("[BERT Topic Analysis] Starting space identification", {
        userId,
        topicCount,
      });

      const spaceProposals = await identifySpacesForTopics({
        userId,
        topics: result.topics,
      });

      logger.info("[BERT Topic Analysis] Space identification completed", {
        userId,
        proposalCount: spaceProposals.length,
      });

      // Step 3: Create or find spaces and assign episodes
      // Get existing spaces from PostgreSQL
      const existingSpacesFromDb = await prisma.space.findMany({
        where: { workspaceId },
      });
      const existingSpacesByName = new Map(
        existingSpacesFromDb.map((s) => [s.name.toLowerCase(), s]),
      );

      for (const proposal of spaceProposals) {
        try {
          // Check if space already exists (case-insensitive match)
          let spaceId: string;
          const existingSpace = existingSpacesByName.get(
            proposal.name.toLowerCase(),
          );

          if (existingSpace) {
            // Use existing space
            spaceId = existingSpace.id;
            logger.info("[BERT Topic Analysis] Using existing space", {
              spaceName: proposal.name,
              spaceId,
            });
          } else {
            // Create new space (creates in both PostgreSQL and Neo4j)
            // Skip automatic space assignment since we're manually assigning from BERT topics
            const spaceService = new SpaceService();
            const newSpace = await spaceService.createSpace(
              {
                name: proposal.name,
                description: proposal.intent,
                userId,
                workspaceId,
              },
              { skipAutoAssignment: true },
            );
            spaceId = newSpace.id;
            logger.info("[BERT Topic Analysis] Created new space", {
              spaceName: proposal.name,
              spaceId,
              intent: proposal.intent,
            });
          }

          // Collect all episode IDs from the topics in this proposal
          const episodeIds: string[] = [];
          for (const topicId of proposal.topics) {
            const topic = result.topics[topicId];
            if (topic) {
              episodeIds.push(...topic.episodeIds);
            }
          }

          // Assign all episodes from these topics to the space
          if (episodeIds.length > 0) {
            await assignEpisodesToSpace(episodeIds, spaceId, userId);
            logger.info("[BERT Topic Analysis] Assigned episodes to space", {
              spaceName: proposal.name,
              spaceId,
              episodeCount: episodeIds.length,
              topics: proposal.topics,
            });

            // Step 4: Trigger space summary if callback provided
            if (enqueueSpaceSummary) {
              await enqueueSpaceSummary({ spaceId, userId });
              logger.info("[BERT Topic Analysis] Triggered space summary", {
                spaceName: proposal.name,
                spaceId,
              });
            }
          }
        } catch (spaceError) {
          logger.error(
            "[BERT Topic Analysis] Failed to process space proposal",
            {
              proposal,
              error: spaceError,
            },
          );
          // Continue with other proposals
        }
      }
    } catch (spaceIdentificationError) {
      logger.error(
        "[BERT Topic Analysis] Space identification failed, returning topics only",
        {
          error: spaceIdentificationError,
        },
      );
      // Return topics even if space identification fails
    }

    return result;
  } catch (error) {
    console.error(`[BERT Topic Analysis] Error:`, error);

    if (error instanceof Error) {
      // Check for timeout
      if (error.message.includes("ETIMEDOUT")) {
        throw new Error(
          `Topic analysis timed out after 5 minutes. User may have too many episodes.`,
        );
      }

      // Check for Python errors
      if (error.message.includes("python3: not found")) {
        throw new Error(`Python 3 is not installed or not available in PATH.`);
      }

      // Check for Neo4j connection errors
      if (error.message.includes("Failed to connect to Neo4j")) {
        throw new Error(
          `Could not connect to Neo4j. Check NEO4J_URI and credentials.`,
        );
      }

      // Check for no episodes
      if (error.message.includes("No episodes found")) {
        throw new Error(`No episodes found for userId: ${userId}`);
      }
    }

    throw error;
  }
}
