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
import {
  createConversation,
  getOrCreateTaskConversation,
} from "~/services/conversation.server";
import { getGeneralistAgent } from "~/services/agent.server";
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

    const task = await getTaskById(taskId);
    if (!task) throw new Error(`Task ${taskId} not found`);

    await markTaskInProcess(taskId);

    const intent = (task.pageId ? await getPageContentAsHtml(task.pageId) : null) ?? task.title;

    // Resolve the owning agent for this task. Falls back to the workspace
    // generalist when the task has no explicit assignee — that way even
    // legacy/unassigned tasks always resolve to a valid conversation.
    let owningAgentId = task.assignedAgentId ?? null;
    if (!owningAgentId) {
      const generalist = await getGeneralistAgent(workspaceId);
      owningAgentId = generalist?.id ?? null;
    }
    if (!owningAgentId) {
      throw new Error(
        `Task ${taskId} has no assigned agent and workspace has no generalist`,
      );
    }

    // Recurring tasks (schedule != null) create a fresh conversation per run
    // so the runs list stays clean and each firing is a discrete thread.
    // One-shot tasks share the single (task, agent) conversation so re-runs
    // and reassignments preserve context.
    const isRecurring = task.schedule != null;
    let conversationId: string;
    if (isRecurring) {
      const result = await createConversation(workspaceId, userId, {
        message: intent,
        parts: [{ text: intent, type: "text" }],
        userType: UserTypeEnum.User,
        asyncJobId: task.id,
        agentId: owningAgentId,
        source: "task",
      });
      conversationId = result.conversationId;
      await updateTaskConversationIds(taskId, [
        ...(task.conversationIds ?? []),
        conversationId,
      ]);
      logger.info(
        `Task ${taskId} (recurring) created run conversation ${conversationId}`,
      );
    } else {
      const { conversationId: convId, created } =
        await getOrCreateTaskConversation(
          workspaceId,
          userId,
          task.id,
          owningAgentId,
        );
      conversationId = convId;
      if (created) {
        await updateTaskConversationIds(taskId, [
          ...(task.conversationIds ?? []),
          conversationId,
        ]);
        logger.info(
          `Task ${taskId} (one-shot) created conversation ${conversationId}`,
        );
      } else {
        logger.info(
          `Task ${taskId} (one-shot) reusing conversation ${conversationId}`,
        );
      }
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

    // Ephemeral trigger for the LLM. Task title/description already live
    // in the system prompt's <task_execution> block (rendered by
    // buildAgentContext when conversation.asyncJobId is set) — the user
    // turn is just the pulse that starts the model call. Not persisted:
    // task.logic passes `skipUserMessage: true` below so this doesn't
    // land in ConversationHistory. Include the displayId for grounding
    // and a reschedule note when we're re-firing an existing task.
    const metadata = (task.metadata as Record<string, unknown>) ?? {};
    const rescheduleCount = (metadata.rescheduleCount as number) ?? 0;
    const rescheduleNote =
      rescheduleCount > 0 ? ` (reschedule ${rescheduleCount}/10)` : "";
    const taskHandle = task.displayId ?? `tk-${taskId}`;
    const taskMessage = `Work on the task ${taskHandle}${rescheduleNote}.`;
    // Silence the unused-variable lint for the pre-existing `intent` —
    // it's kept around in case a caller wants to reintroduce a richer
    // trigger message later without re-plumbing the DB read.
    void intent;

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
