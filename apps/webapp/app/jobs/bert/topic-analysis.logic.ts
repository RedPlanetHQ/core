import { exec } from "child_process";
import { promisify } from "util";
import { identifySpacesForTopics } from "~/jobs/spaces/space-identification.logic";
import { logger } from "~/services/logger.service";
import { getEpisode } from "~/services/graphModels/episode";
import { makeModelCall } from "~/lib/model.server";
import type { EpisodicNode } from "@core/types";

const execAsync = promisify(exec);

export interface TopicAnalysisPayload {
  userId: string;
  workspaceId: string;
  minTopicSize?: number;
  nrTopics?: number;
}

export interface DocumentSummary {
  spaceName: string;
  intent: string;
  summary: string;
  topics: string[];
  episodeCount: number;
}

export interface TopicAnalysisResult {
  topics: {
    [topicId: string]: {
      keywords: string[];
      episodeIds: string[];
    };
  };
  documentSummaries?: DocumentSummary[];
}

/**
 * Run BERT analysis using exec (for BullMQ/Docker)
 */
async function runBertWithExec(
  userId: string,
  minTopicSize: number,
  nrTopics?: number,
): Promise<string> {
  let command = `python3 /core/apps/webapp/python/main.py ${userId} --json`;

  console.log(`[BERT Topic Analysis] Executing: ${command}`);

  const { stdout, stderr } = await execAsync(command, {
    timeout: 300000, // 5 minutes
    maxBuffer: 10 * 1024 * 1024, // 10MB buffer for large outputs
    env: {
      ...process.env,
    },
  });

  if (stderr) {
    console.warn(`[BERT Topic Analysis] Warnings:`, stderr);
  }

  return stdout;
}

/**
 * Create a document summary from episodes using LLM
 *
 * @param episodes - Array of episode objects to summarize
 * @param intent - The intent/purpose of the document (from space proposal)
 * @param spaceName - Name of the space this document represents
 * @returns A cohesive summary document
 */
async function createDocumentSummaryFromEpisodes(
  episodes: EpisodicNode[],
  intent: string,
  spaceName: string,
): Promise<string> {
  // Build the prompt for document summary generation
  const episodeTexts = episodes
    .map((ep, idx) => `### Episode ${idx + 1}\n${ep.content}`)
    .join("\n\n");

  const prompt = `You are creating a comprehensive summary document for a collection of related episodes.

## Document Purpose
**Space Name**: ${spaceName}
**Intent**: ${intent}

## Episodes to Summarize
The following episodes have been identified as related to this topic:

${episodeTexts}

## Task
Create a cohesive, well-structured summary document that:
1. Synthesizes the key themes and insights from these episodes
2. Organizes information in a logical, readable format
3. Maintains the context and intent described above
4. Highlights important patterns, concepts, or recurring themes
5. Uses clear headings and structure for easy reference

The summary should be comprehensive enough to capture the essence of all episodes while being concise and well-organized.

Return ONLY the summary document content, no additional commentary.`;

  logger.info("[Document Summary] Generating summary for space", {
    spaceName,
    episodeCount: episodes.length,
    intent,
  });

  let summaryText = "";
  await makeModelCall(
    false, // not streaming
    [{ role: "user", content: prompt }],
    (text) => {
      summaryText = text;
    },
    {
      temperature: 0.7,
    },
    "high", // Use high complexity model for better summaries
  );

  logger.info("[Document Summary] Summary generated", {
    spaceName,
    summaryLength: summaryText.length,
  });

  return summaryText;
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
    const documentSummaries: DocumentSummary[] = [];

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

      // Step 3: Generate document summaries for each space proposal
      for (const proposal of spaceProposals) {
        try {
          // Collect all episode IDs from the topics in this proposal
          const episodeIds: string[] = [];
          for (const topicId of proposal.topics) {
            const topic = result.topics[topicId];
            if (topic) {
              episodeIds.push(...topic.episodeIds);
            }
          }

          if (episodeIds.length === 0) {
            logger.warn(
              "[BERT Topic Analysis] No episodes found for proposal",
              {
                spaceName: proposal.name,
              },
            );
            continue;
          }

          // Fetch top 5-10 episodes for summary generation
          const episodesToFetch = episodeIds.slice(0, 10);
          const episodes = await Promise.all(
            episodesToFetch.map((id) => getEpisode(id)),
          );

          // Filter out null episodes
          const validEpisodes = episodes.filter(
            (ep): ep is EpisodicNode => ep !== null,
          );

          if (validEpisodes.length === 0) {
            logger.warn(
              "[BERT Topic Analysis] No valid episodes found for proposal",
              {
                spaceName: proposal.name,
              },
            );
            continue;
          }

          logger.info(
            "[BERT Topic Analysis] Generating document summary for space",
            {
              spaceName: proposal.name,
              episodeCount: validEpisodes.length,
              totalEpisodes: episodeIds.length,
              topics: proposal.topics,
            },
          );

          // Generate document summary from episodes
          const summary = await createDocumentSummaryFromEpisodes(
            validEpisodes,
            proposal.intent,
            proposal.name,
          );

          documentSummaries.push({
            spaceName: proposal.name,
            intent: proposal.intent,
            summary,
            topics: proposal.topics,
            episodeCount: episodeIds.length,
          });

          logger.info("[BERT Topic Analysis] Document summary created", {
            spaceName: proposal.name,
            summaryLength: summary.length,
          });
        } catch (summaryError) {
          logger.error(
            "[BERT Topic Analysis] Failed to create document summary",
            {
              proposal,
              error: summaryError,
            },
          );
          // Continue with other proposals
        }
      }

      logger.info(
        "[BERT Topic Analysis] Document summary generation completed",
        {
          summariesGenerated: documentSummaries.length,
        },
      );
    } catch (spaceIdentificationError) {
      logger.error(
        "[BERT Topic Analysis] Space identification failed, returning topics only",
        {
          error: spaceIdentificationError,
        },
      );
      // Return topics even if space identification fails
    }

    // Return topics and document summaries
    result.documentSummaries = documentSummaries;

    console.log(JSON.stringify(documentSummaries));
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
