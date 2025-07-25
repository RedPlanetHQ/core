import { ActionStatusEnum } from "@core/types";
import { metadata, task, queue } from "@trigger.dev/sdk";

import { run } from "./chat-utils";
import { MCP } from "../utils/mcp";
import { type HistoryStep } from "../utils/types";
import {
  createConversationHistoryForAgent,
  deletePersonalAccessToken,
  getCreditsForUser,
  getPreviousExecutionHistory,
  init,
  type RunChatPayload,
  updateConversationHistoryMessage,
  updateConversationStatus,
  updateExecutionStep,
  updateUserCredits,
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
    const usageCredits = await getCreditsForUser(init?.userId as string);

    await updateConversationStatus("running", payload.conversationId);

    try {
      let creditForChat = 0;

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

      usageCredits && (await updateUserCredits(usageCredits, 1));

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
