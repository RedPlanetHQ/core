import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

export interface TopicAnalysisPayload {
  userId: string;
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
 * Process BERT topic analysis on user's episodes
 * This is the common logic shared between Trigger.dev and BullMQ
 *
 * NOTE: This function does NOT update workspace.metadata.lastTopicAnalysisAt
 * That should be done by the caller BEFORE enqueueing this job to prevent
 * duplicate analyses from racing conditions.
 */
export async function processTopicAnalysis(
  payload: TopicAnalysisPayload
): Promise<TopicAnalysisResult> {
  const { userId, minTopicSize = 10, nrTopics } = payload;

  console.log(`[BERT Topic Analysis] Starting analysis for user: ${userId}`);
  console.log(
    `[BERT Topic Analysis] Parameters: minTopicSize=${minTopicSize}, nrTopics=${nrTopics || "auto"}`
  );

  // Build the command
  let command = `python3 /core/apps/webapp/app/bert/main.py ${userId} --json`;

  if (minTopicSize) {
    command += ` --min-topic-size ${minTopicSize}`;
  }

  if (nrTopics) {
    command += ` --nr-topics ${nrTopics}`;
  }

  console.log(`[BERT Topic Analysis] Executing: ${command}`);

  try {
    const startTime = Date.now();

    // Execute the Python script with a 5-minute timeout
    const { stdout, stderr } = await execAsync(command, {
      timeout: 300000, // 5 minutes
      maxBuffer: 10 * 1024 * 1024, // 10MB buffer for large outputs
    });

    const duration = Date.now() - startTime;
    console.log(`[BERT Topic Analysis] Completed in ${duration}ms`);

    if (stderr) {
      console.warn(`[BERT Topic Analysis] Warnings:`, stderr);
    }

    // Parse the JSON output
    const result: TopicAnalysisResult = JSON.parse(stdout);

    // Log summary
    const topicCount = Object.keys(result.topics).length;
    const totalEpisodes = Object.values(result.topics).reduce(
      (sum, topic) => sum + topic.episodeIds.length,
      0
    );

    console.log(
      `[BERT Topic Analysis] Found ${topicCount} topics covering ${totalEpisodes} episodes`
    );

    return result;
  } catch (error) {
    console.error(`[BERT Topic Analysis] Error:`, error);

    if (error instanceof Error) {
      // Check for timeout
      if (error.message.includes("ETIMEDOUT")) {
        throw new Error(
          `Topic analysis timed out after 5 minutes. User may have too many episodes.`
        );
      }

      // Check for Python errors
      if (error.message.includes("python3: not found")) {
        throw new Error(
          `Python 3 is not installed or not available in PATH.`
        );
      }

      // Check for Neo4j connection errors
      if (error.message.includes("Failed to connect to Neo4j")) {
        throw new Error(
          `Could not connect to Neo4j. Check NEO4J_URI and credentials.`
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
