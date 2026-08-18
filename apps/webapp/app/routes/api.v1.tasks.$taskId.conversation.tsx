import { json, type LoaderFunctionArgs } from "@remix-run/node";
import { requireUser } from "~/services/session.server";
import { prisma } from "~/db.server";
import {
  getConversationHistoryPage,
  getOrCreateTaskConversation,
} from "~/services/conversation.server";
import { getGeneralistAgent } from "~/services/agent.server";

/**
 * GET /api/v1/tasks/:taskId/conversation
 *
 * Returns the per-(task, assignedAgent) chat conversation, creating an empty
 * row on first access. If the task has no assignedAgentId, we fall back to
 * the workspace generalist so the chat pane still has an owner.
 */
export async function loader({ request, params }: LoaderFunctionArgs) {
  const { workspaceId, id: userId } = await requireUser(request);
  if (!workspaceId || !userId) {
    return json({ error: "unauthorized" }, { status: 401 });
  }
  const taskId = params.taskId;
  if (!taskId) return json({ error: "taskId required" }, { status: 400 });

  const task = await prisma.task.findFirst({
    where: { id: taskId, workspaceId: workspaceId as string },
    select: { id: true, assignedAgentId: true },
  });
  if (!task) return json({ error: "Not found" }, { status: 404 });

  let agentId = task.assignedAgentId;
  if (!agentId) {
    const generalist = await getGeneralistAgent(workspaceId as string);
    agentId = generalist?.id ?? null;
  }
  if (!agentId) {
    return json({ error: "no owning agent available" }, { status: 500 });
  }

  const { conversationId } = await getOrCreateTaskConversation(
    workspaceId as string,
    userId as string,
    task.id,
    agentId,
  );

  const conversation = await getConversationHistoryPage(
    conversationId,
    userId as string,
  );

  return json({ conversation, agentId });
}
