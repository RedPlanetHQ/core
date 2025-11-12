import { exec } from "child_process";
import { promisify } from "util";
import { identifySpacesForTopics } from "~/jobs/spaces/space-identification.logic";
import { logger } from "~/services/logger.service";
import { getEpisode } from "~/services/graphModels/episode";
import { makeModelCall, getModelForTask, isProprietaryModel } from "~/lib/model.server";
import { createBatch, getBatch } from "~/lib/batch.server";
import { addToQueue, IngestBodyRequest } from "~/lib/ingest.server";
import { EpisodeType, type EpisodicNode } from "@core/types";
import { z } from "zod";

const execAsync = promisify(exec);

export interface TopicAnalysisPayload {
  userId: string;
  workspaceId: string;
  minTopicSize?: number;
  nrTopics?: number;
}

export interface DocumentSummary {
  title: string; // Document title describing the theme
  theme: string; // What this collection of topics is about
  summary: string; // LLM-generated summary content
  topics: string[]; // Topic IDs included in this document
  episodeCount: number; // Total episodes covered
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
 * @param theme - The main theme/subject of these episodes
 * @param title - Document title describing what the user talks about
 * @returns A cohesive summary document
 */
async function createDocumentSummaryFromEpisodes(
  episodes: EpisodicNode[],
  theme: string,
  title: string,
): Promise<string> {
  // Build the prompt for document summary generation
  const episodeTexts = episodes
    .map((ep, idx) => `### Episode ${idx + 1}\n${ep.content}`)
    .join("\n\n");

  const prompt = `You are creating a comprehensive summary document about topics the user frequently discusses.

## Document Theme
**Title**: ${title}
**Theme**: ${theme}

## Episodes to Summarize
The following episodes represent conversations where the user discussed this topic:

${episodeTexts}

## Task
Create a cohesive, well-structured summary document that:
1. Synthesizes what the user talks about regarding this theme
2. Captures the key insights, patterns, and recurring concepts
3. Organizes information in a logical, readable format
4. Highlights the user's perspectives, experiences, or knowledge on this topic
5. Uses clear headings and structure for easy reference

This document will help the user understand what they frequently discuss about "${title}" and serve as a reference for this topic area.

Return ONLY the summary document content, no additional commentary.`;

  logger.info("[Document Summary] Generating summary for topic theme", {
    title,
    episodeCount: episodes.length,
    theme,
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
    title,
    summaryLength: summaryText.length,
  });

  return summaryText;
}

/**
 * Generate document summaries sequentially (for non-OpenAI models)
 *
 * @param proposals - Array of theme proposals with topics and metadata
 * @param topicsData - Topics data containing episode IDs
 * @param documentSummaries - Array to push generated summaries into
 */
async function generateSequentialSummaries(
  proposals: Array<{
    name: string;
    intent: string;
    topics: string[];
  }>,
  topicsData: { [topicId: string]: { keywords: string[]; episodeIds: string[] } },
  documentSummaries: DocumentSummary[],
): Promise<void> {
  for (const proposal of proposals) {
    try {
      // Collect all episode IDs from the topics in this proposal
      const episodeIds: string[] = [];
      for (const topicId of proposal.topics) {
        const topic = topicsData[topicId];
        if (topic) {
          episodeIds.push(...topic.episodeIds);
        }
      }

      if (episodeIds.length === 0) {
        logger.warn("[BERT Topic Analysis] No episodes found for theme", {
          theme: proposal.name,
        });
        continue;
      }

      // Fetch top 10 episodes for summary generation
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
          "[BERT Topic Analysis] No valid episodes found for theme",
          {
            theme: proposal.name,
          },
        );
        continue;
      }

      logger.info(
        "[BERT Topic Analysis] Generating document summary about topic theme",
        {
          title: proposal.name,
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
        title: proposal.name,
        theme: proposal.intent,
        summary,
        topics: proposal.topics,
        episodeCount: episodeIds.length,
      });

      logger.info("[BERT Topic Analysis] Document summary created", {
        title: proposal.name,
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
}

/**
 * Create document summaries using batch processing (for OpenAI models)
 *
 * @param proposals - Array of theme proposals with topics and metadata
 * @param topicsData - Topics data containing episode IDs
 * @returns Array of document summaries
 */
async function createDocumentSummariesBatch(
  proposals: Array<{
    name: string;
    intent: string;
    topics: string[];
  }>,
  topicsData: { [topicId: string]: { keywords: string[]; episodeIds: string[] } },
): Promise<DocumentSummary[]> {
  logger.info("[Document Summary] Starting batch processing", {
    proposalCount: proposals.length,
  });

  // Step 1: Prepare all episode data for batch processing
  const batchRequests = [];
  const proposalMetadata: Array<{
    proposal: { name: string; intent: string; topics: string[] };
    episodeIds: string[];
    validEpisodes: EpisodicNode[];
  }> = [];

  for (const proposal of proposals) {
    try {
      // Collect all episode IDs from the topics in this proposal
      const episodeIds: string[] = [];
      for (const topicId of proposal.topics) {
        const topic = topicsData[topicId];
        if (topic) {
          episodeIds.push(...topic.episodeIds);
        }
      }

      if (episodeIds.length === 0) {
        logger.warn("[Document Summary] No episodes found for theme", {
          theme: proposal.name,
        });
        continue;
      }

      // Fetch top 10 episodes for summary generation
      const episodesToFetch = episodeIds.slice(0, 10);
      const episodes = await Promise.all(
        episodesToFetch.map((id) => getEpisode(id)),
      );

      // Filter out null episodes
      const validEpisodes = episodes.filter(
        (ep): ep is EpisodicNode => ep !== null,
      );

      if (validEpisodes.length === 0) {
        logger.warn("[Document Summary] No valid episodes found for theme", {
          theme: proposal.name,
        });
        continue;
      }

      // Store metadata for later processing
      proposalMetadata.push({
        proposal,
        episodeIds,
        validEpisodes,
      });

      // Build the prompt for this proposal
      const episodeTexts = validEpisodes
        .map((ep, idx) => `### Episode ${idx + 1}\n${ep.content}`)
        .join("\n\n");

      const prompt = `You are creating a comprehensive summary document about topics the user frequently discusses.

## Document Theme
**Title**: ${proposal.name}
**Theme**: ${proposal.intent}

## Episodes to Summarize
The following episodes represent conversations where the user discussed this topic:

${episodeTexts}

## Task
Create a cohesive, well-structured summary document that:
1. Synthesizes what the user talks about regarding this theme
2. Captures the key insights, patterns, and recurring concepts
3. Organizes information in a logical, readable format
4. Highlights the user's perspectives, experiences, or knowledge on this topic
5. Uses clear headings and structure for easy reference

This document will help the user understand what they frequently discuss about "${proposal.name}" and serve as a reference for this topic area.

Return ONLY the summary document content, no additional commentary.`;

      batchRequests.push({
        customId: `summary-${proposal.name}`,
        messages: [{ role: "user" as const, content: prompt }],
        options: { temperature: 0.7 },
      });
    } catch (error) {
      logger.error("[Document Summary] Failed to prepare batch request", {
        proposal,
        error,
      });
    }
  }

  if (batchRequests.length === 0) {
    logger.warn("[Document Summary] No valid batch requests to process");
    return [];
  }

  logger.info("[Document Summary] Submitting batch with requests", {
    requestCount: batchRequests.length,
  });

  // Step 2: Create batch job
  const { batchId } = await createBatch({
    requests: batchRequests,
    modelComplexity: "high",
  });

  logger.info("[Document Summary] Batch job created", { batchId });

  // Step 3: Poll for batch completion (with timeout)
  const maxWaitTime = 10 * 60 * 1000; // 10 minutes
  const pollInterval = 5000; // 5 seconds
  const startTime = Date.now();

  let batchJob;
  while (Date.now() - startTime < maxWaitTime) {
    batchJob = await getBatch({ batchId });

    logger.info("[Document Summary] Batch status check", {
      batchId,
      status: batchJob.status,
      completed: batchJob.completedRequests,
      total: batchJob.totalRequests,
    });

    if (batchJob.status === "completed") {
      break;
    }

    if (batchJob.status === "failed" || batchJob.status === "cancelled") {
      throw new Error(`Batch job ${batchId} ${batchJob.status}`);
    }

    // Wait before next poll
    await new Promise((resolve) => setTimeout(resolve, pollInterval));
  }

  if (!batchJob || batchJob.status !== "completed") {
    throw new Error(`Batch job ${batchId} timed out or failed to complete`);
  }

  // Step 4: Process results
  const documentSummaries: DocumentSummary[] = [];

  if (!batchJob.results) {
    logger.error("[Document Summary] Batch completed but no results found");
    return [];
  }

  for (let i = 0; i < proposalMetadata.length; i++) {
    const metadata = proposalMetadata[i];
    const result = batchJob.results.find(
      (r) => r.customId === `summary-${metadata.proposal.name}`,
    );

    if (result?.response && !result.error) {
      const summary = typeof result.response === "string"
        ? result.response
        : JSON.stringify(result.response);

      documentSummaries.push({
        title: metadata.proposal.name,
        theme: metadata.proposal.intent,
        summary,
        topics: metadata.proposal.topics,
        episodeCount: metadata.episodeIds.length,
      });

      logger.info("[Document Summary] Document summary created from batch", {
        title: metadata.proposal.name,
        summaryLength: summary.length,
      });
    } else {
      logger.error("[Document Summary] Failed to get summary from batch", {
        proposal: metadata.proposal.name,
        error: result?.error,
      });
    }
  }

  logger.info("[Document Summary] Batch processing completed", {
    documentsGenerated: documentSummaries.length,
  });

  return documentSummaries;
}

/**
 * Process BERT topic analysis on user's episodes and generate document summaries
 *
 * Workflow:
 * 1. BERT identifies topics from episode clusters (based on semantic similarity)
 * 2. LLM analyzes topics to identify main themes the user talks about
 * 3. For each theme, generates a comprehensive summary document from the episodes
 *
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

    // Step 2: Identify topic themes using LLM (what the user talks about most)
    const documentSummaries: DocumentSummary[] = [];

    try {
      logger.info("[BERT Topic Analysis] Identifying topic themes", {
        userId,
        topicCount,
      });

      // Note: Using identifySpacesForTopics for now, but it's actually identifying
      // thematic groupings for document generation, not creating spaces
      const themeProposals = await identifySpacesForTopics({
        userId,
        topics: result.topics,
      });

      logger.info(
        "[BERT Topic Analysis] Topic theme identification completed",
        {
          userId,
          themeCount: themeProposals.length,
        },
      );

      // Step 3: Generate document summaries for each identified theme
      // Check if we can use batch processing (OpenAI models only)
      const modelForTask = getModelForTask("high");
      const canUseBatch = modelForTask.includes("gpt") || modelForTask.includes("o1");

      if (canUseBatch) {
        logger.info(
          "[BERT Topic Analysis] Using batch processing for document summaries",
          { model: modelForTask },
        );

        try {
          // Use batch processing for all summaries at once
          const batchSummaries = await createDocumentSummariesBatch(
            themeProposals,
            result.topics,
          );
          documentSummaries.push(...batchSummaries);

          logger.info(
            "[BERT Topic Analysis] Batch document summary generation completed",
            {
              documentsGenerated: documentSummaries.length,
            },
          );
        } catch (batchError) {
          logger.error(
            "[BERT Topic Analysis] Batch processing failed, falling back to sequential",
            { error: batchError },
          );
          // Fall back to sequential processing below
          await generateSequentialSummaries(
            themeProposals,
            result.topics,
            documentSummaries,
          );
        }
      } else {
        logger.info(
          "[BERT Topic Analysis] Using sequential processing for document summaries",
          { model: modelForTask },
        );
        // Use sequential processing for non-OpenAI models
        await generateSequentialSummaries(
          themeProposals,
          result.topics,
          documentSummaries,
        );
      }

      logger.info(
        "[BERT Topic Analysis] Document summary generation completed",
        {
          documentsGenerated: documentSummaries.length,
        },
      );

      // Step 4: Ingest document summaries as episodic documents
      if (documentSummaries.length > 0) {
        logger.info(
          "[BERT Topic Analysis] Ingesting document summaries",
          {
            documentCount: documentSummaries.length,
          },
        );

        for (const docSummary of documentSummaries) {
          try {
            const ingestDocumentData: z.infer<typeof IngestBodyRequest> = {
              episodeBody: docSummary.summary,
              referenceTime: new Date().toISOString(),
              type: EpisodeType.DOCUMENT,
              source: "topic-analysis",
              metadata: {
                documentTitle: docSummary.title,
                theme: docSummary.theme,
                episodeCount: docSummary.episodeCount,
              },
            };

            await addToQueue(ingestDocumentData, userId);

            logger.info("[BERT Topic Analysis] Document ingested", {
              title: docSummary.title,
              episodeCount: docSummary.episodeCount,
            });
          } catch (ingestError) {
            logger.error(
              "[BERT Topic Analysis] Failed to ingest document",
              {
                title: docSummary.title,
                error: ingestError,
              },
            );
            // Continue with other documents
          }
        }

        logger.info(
          "[BERT Topic Analysis] All documents ingested",
          {
            documentsIngested: documentSummaries.length,
          },
        );
      }
    } catch (themeIdentificationError) {
      logger.error(
        "[BERT Topic Analysis] Topic theme identification failed, returning topics only",
        {
          error: themeIdentificationError,
        },
      );
      // Return topics even if theme identification fails
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
