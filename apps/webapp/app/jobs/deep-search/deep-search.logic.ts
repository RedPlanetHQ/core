import { type CoreMessage } from "ai";
import { logger } from "~/services/logger.service";
import { nanoid } from "nanoid";
import {
  deletePersonalAccessToken,
  getOrCreatePersonalAccessToken,
} from "~/trigger/utils/utils";
import { getReActPrompt } from "~/trigger/deep-search/prompt";
import { createSearchMemoryTool } from "~/trigger/deep-search/utils";
import { run } from "~/trigger/deep-search/deep-search-utils";
import { AgentMessageType } from "~/trigger/chat/types";

export interface ProcessDeepSearchPayload {
  content: string;
  userId: string;
  metadata?: any;
  intentOverride?: string;
}

export interface ProcessDeepSearchResult {
  success: boolean;
  synthesis?: string;
  error?: string;
}

/**
 * Core business logic for deep search (non-streaming version for BullMQ)
 * This is shared logic, but the streaming happens in Trigger.dev via metadata.stream
 */
export async function processDeepSearch(
  payload: ProcessDeepSearchPayload,
): Promise<ProcessDeepSearchResult> {
  const { content, userId, metadata: meta, intentOverride } = payload;

  const randomKeyName = `deepSearch_${nanoid(10)}`;

  // Get or create token for search API calls
  const pat = await getOrCreatePersonalAccessToken({
    name: randomKeyName,
    userId: userId as string,
  });

  if (!pat?.token) {
    return {
      success: false,
      error: "Failed to create personal access token",
    };
  }

  try {
    // Create search tool that agent will use
    const searchTool = createSearchMemoryTool(pat.token);

    // Build initial messages with ReAct prompt
    const initialMessages: CoreMessage[] = [
      {
        role: "system",
        content: getReActPrompt(meta, intentOverride),
      },
      {
        role: "user",
        content: `CONTENT TO ANALYZE:\n${content}\n\nPlease search my memory for relevant context and synthesize what you find.`,
      },
    ];

    // Run the ReAct loop generator
    const llmResponse = run(initialMessages, searchTool);

    let synthesis = "";

    // For BullMQ: iterate without streaming, just accumulate the final synthesis
    for await (const step of llmResponse) {
      // MESSAGE_CHUNK: Final synthesis - accumulate
      if (step.type === AgentMessageType.MESSAGE_CHUNK) {
        synthesis += step.message;
      }

      // STREAM_END: Loop completed
      if (step.type === AgentMessageType.STREAM_END) {
        break;
      }
    }

    await deletePersonalAccessToken(pat?.id);

    // Clean up any remaining tags
    synthesis = synthesis
      .replace(/<final_response>/gi, "")
      .replace(/<\/final_response>/gi, "")
      .trim();

    return {
      success: true,
      synthesis,
    };
  } catch (error: any) {
    await deletePersonalAccessToken(pat?.id);
    logger.error(`Deep search error: ${error}`);
    return {
      success: false,
      error: error.message,
    };
  }
}
