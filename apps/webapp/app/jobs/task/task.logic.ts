import {
  markTaskInProcess,
  markTaskCompleted,
  markTaskFailed,
  getTaskById,
  updateTaskConversationIds,
} from "~/services/task.server";
import { getPageContentAsHtml } from "~/services/hocuspocus/content.server";
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

    const intent = (task.pageId ? await getPageContentAsHtml(task.pageId) : null) ?? task.title;

    // Reuse the last conversation if one exists, otherwise create new
    let conversationId: string;
    const existingConversationIds = task.conversationIds ?? [];

    if (existingConversationIds.length > 0) {
      // Reuse the last conversation — preserves full context
      conversationId = existingConversationIds[existingConversationIds.length - 1];
      logger.info(`Task ${taskId} reusing conversation ${conversationId}`);
    } else {
      // First run — create a new conversation
      const result = await createConversation(workspaceId, userId, {
        message: intent,
        parts: [{ text: intent, type: "text" }],
        userType: UserTypeEnum.User,
        asyncJobId: task.id,
        source: "task",
      });
      conversationId = result.conversationId;
      await updateTaskConversationIds(taskId, [conversationId]);
      logger.info(`Task ${taskId} created new conversation ${conversationId}`);
    }

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

    // Prefix intent with task context so the agent knows its own taskId
    // and can embed it in any reminders it creates (e.g. after starting a coding session)
    const metadata = (task.metadata as Record<string, unknown>) ?? {};
    const rescheduleCount = (metadata.rescheduleCount as number) ?? 0;
    const rescheduleNote = rescheduleCount > 0 ? ` [reschedule:${rescheduleCount}/10]` : "";
    const taskMessage = `[background-task taskId:${taskId}${rescheduleNote}]\n${intent}`;

    try {
      await processInboundMessage({
        userId,
        workspaceId,
        channel: "web",
        userMessage: taskMessage,
        conversationId,
        skipUserMessage: true,
        executorTools,
      });

      clearTimeout(timeoutId);

      // Agent owns task lifecycle — it decides completed/blocked/failed via update_task.
      // We only log here. No auto-marking.
      logger.info(`Task ${taskId} processing finished`);
      return { success: true, status: "completed", result: "Task processing finished" };
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
    // Only mark failed on actual crashes — agent handles normal lifecycle
    await markTaskFailed(taskId, errorMsg);
    return { success: false, status: "failed", error: errorMsg };
  }
}
