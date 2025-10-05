import { ActionStatusEnum, EpisodeTypeEnum } from "@core/types";
import { metadata, task, queue, logger } from "@trigger.dev/sdk";

import { run } from "./chat-utils";
import { MCP } from "../utils/mcp";
import { type HistoryStep } from "../utils/types";
import { prisma } from "../utils/prisma";
import {
  createConversationHistoryForAgent,
  deductCredits,
  deletePersonalAccessToken,
  getPreviousExecutionHistory,
  hasCredits,
  InsufficientCreditsError,
  init,
  type RunChatPayload,
  updateConversationHistoryMessage,
  updateConversationStatus,
  updateExecutionStep,
} from "../utils/utils";

const chatQueue = queue({
  name: "chat-queue",
  concurrencyLimit: 50,
});

/**
 * Main chat task that orchestrates the agent workflow
 * Handles conversation context, agent selection, and LLM interactions
 */
export const chat = task({
  id: "chat",
  maxDuration: 3000,
  queue: chatQueue,
  init,
  run: async (payload: RunChatPayload, { init }) => {
    await updateConversationStatus("running", payload.conversationId);

    try {
      // Check if workspace has sufficient credits before processing
      if (init?.conversation.workspaceId) {
        const hasSufficientCredits = await hasCredits(
          init.conversation.workspaceId,
          "chatMessage",
        );

        if (!hasSufficientCredits) {
          throw new InsufficientCreditsError(
            "Insufficient credits to process chat message. Please upgrade your plan or wait for your credits to reset.",
          );
        }
      }

      const { previousHistory, ...otherData } = payload.context;

      const { agents = [] } = payload.context;
      // Initialise mcp
      const mcpHeaders = { Authorization: `Bearer ${init?.token}` };
      const mcp = new MCP();
      await mcp.init();
      await mcp.load(agents, mcpHeaders);

      // Prepare context with additional metadata
      const context = {
        // Currently this is assuming we only have one page in context
        context: {
          ...(otherData.page && otherData.page.length > 0
            ? { page: otherData.page[0] }
            : {}),
        },
        workpsaceId: init?.conversation.workspaceId,
        resources: otherData.resources,
        todayDate: new Date().toISOString(),
      };

      // Extract user's goal from conversation history
      const message = init?.conversationHistory?.message;
      // Retrieve execution history from previous interactions
      const previousExecutionHistory = getPreviousExecutionHistory(
        previousHistory ?? [],
      );

      let agentUserMessage = "";
      let agentConversationHistory;
      let stepHistory: HistoryStep[] = [];
      // Prepare conversation history in agent-compatible format
      agentConversationHistory = await createConversationHistoryForAgent(
        payload.conversationId,
      );

      const llmResponse = run(
        message as string,
        context,
        previousExecutionHistory,
        mcp,
        stepHistory,
        init?.mcpServers ?? [],
        mcpHeaders,
      );

      const stream = await metadata.stream("messages", llmResponse);

      let conversationStatus = "success";
      for await (const step of stream) {
        if (step.type === "STEP") {
          const stepDetails = JSON.parse(step.message as string);

          if (stepDetails.skillStatus === ActionStatusEnum.TOOL_REQUEST) {
            conversationStatus = "need_approval";
          }

          if (stepDetails.skillStatus === ActionStatusEnum.QUESTION) {
            conversationStatus = "need_attention";
          }

          await updateExecutionStep(
            { ...stepDetails },
            agentConversationHistory.id,
          );

          agentUserMessage += stepDetails.userMessage;

          await updateConversationHistoryMessage(
            agentUserMessage,
            agentConversationHistory.id,
          );
        } else if (step.type === "STREAM_END") {
          break;
        }
      }

      await updateConversationStatus(
        conversationStatus,
        payload.conversationId,
      );

      // Auto-ingest conversation to knowledge graph (after successful completion)
      try {
        if (conversationStatus === "success" && init?.conversation.workspaceId) {
          // Fetch complete conversation history for ingestion
          const fullConversationHistory = await prisma.conversationHistory.findMany({
            where: {
              conversationId: payload.conversationId,
              deleted: null,
            },
            orderBy: {
              createdAt: "asc",
            },
          });

          // Format conversation history as text
          const conversationText = fullConversationHistory
            .map((entry) => {
              const userType = entry.userType === "User" ? "User" : "Assistant";
              return `${userType}: ${entry.message}`;
            })
            .join("\n\n---\n\n");

          // Add to ingestion queue
          if (conversationText.trim()) {
            const { addToQueue } = await import("~/lib/ingest.server");

            await addToQueue(
              {
                episodeBody: conversationText,
                referenceTime: new Date().toISOString(),
                source: "web_chat",
                type: EpisodeTypeEnum.CONVERSATION,
              },
              init.conversation.userId,
            );

            logger.info("Chat conversation auto-ingested", {
              conversationId: payload.conversationId,
              messageCount: fullConversationHistory.length,
            });
          }
        }
      } catch (ingestionError) {
        // Log error but don't fail the conversation
        logger.error("Failed to auto-ingest conversation", {
          conversationId: payload.conversationId,
          error: ingestionError,
        });
        // Continue execution - ingestion failure should not impact chat
      }

      // Deduct credits for chat message
      if (init?.conversation.workspaceId) {
        await deductCredits(init.conversation.workspaceId, "chatMessage");
      }

      if (init?.tokenId) {
        await deletePersonalAccessToken(init.tokenId);
      }
    } catch (e) {
      await updateConversationStatus("failed", payload.conversationId);
      if (init?.tokenId) {
        await deletePersonalAccessToken(init.tokenId);
      }
      throw new Error(e as string);
    }
  },
});
