import {
  markTaskInProcess,
  markTaskCompleted,
  markTaskFailed,
  getTaskById,
  updateTaskConversationIds,
} from "~/services/task.server";
import { logger } from "~/services/logger.service";
import { env } from "~/env.server";
import { getOrCreatePersonalAccessToken } from "~/services/personalAccessToken.server";
import { CoreClient } from "@redplanethq/sdk";
import { HttpOrchestratorTools } from "~/services/agent/orchestrator-tools.http";
import { createConversation } from "~/services/conversation.server";
import { processInboundMessage } from "~/services/agent/message-processor";
import { UserTypeEnum } from "@core/types";

export interface TaskPayload {
  taskId: string;
  workspaceId: string;
  userId: string;
  timeoutMs?: number;
}

export interface TaskResult {
  success: boolean;
  status: "completed" | "failed" | "timeout";
  result?: string;
  error?: string;
}

export async function processTask(payload: TaskPayload): Promise<TaskResult> {
  const { taskId, workspaceId, userId, timeoutMs = 1800000 } = payload;

  try {
    logger.info(`Processing task ${taskId}`, { workspaceId });

    await markTaskInProcess(taskId);

    const task = await getTaskById(taskId);
    if (!task) throw new Error(`Task ${taskId} not found`);

    const intent = task.description ?? task.title;

    const { conversationId } = await createConversation(workspaceId, userId, {
      message: intent,
      parts: [{ text: intent, type: "text" }],
      userType: UserTypeEnum.User,
      asyncJobId: task.id,
      source: "task",
    });

    await updateTaskConversationIds(taskId, [conversationId]);

    const { token } = await getOrCreatePersonalAccessToken({
      name: "task-internal",
      userId,
      workspaceId,
      returnDecrypted: true,
    });
    const client = new CoreClient({ baseUrl: env.APP_ORIGIN, token: token! });
    const executorTools = new HttpOrchestratorTools(client);

    const abortController = new AbortController();
    const timeoutId = setTimeout(() => abortController.abort(), timeoutMs);

    try {
      await processInboundMessage({
        userId,
        workspaceId,
        channel: "web",
        userMessage: intent,
        conversationId,
        skipUserMessage: true,
        executorTools,
      });

      clearTimeout(timeoutId);
      await markTaskCompleted(taskId, "Task completed");

      logger.info(`Task ${taskId} completed`);
      return { success: true, status: "completed", result: "Task completed" };
    } catch (error) {
      clearTimeout(timeoutId);

      if (abortController.signal.aborted) {
        logger.info(`Task ${taskId} timed out`);
        await markTaskFailed(taskId, "Task exceeded timeout limit");
        return {
          success: false,
          status: "timeout",
          error: "Task exceeded timeout limit",
        };
      }

      throw error;
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : "Unknown error";
    logger.error(`Task ${taskId} failed`, { error });
    await markTaskFailed(taskId, errorMsg);
    return { success: false, status: "failed", error: errorMsg };
  }
}
