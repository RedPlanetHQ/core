import { json, type LoaderFunctionArgs } from "@remix-run/node";
import { requireUser } from "~/services/session.server";
import { prisma } from "~/db.server";
import { getTaskRuns } from "~/services/conversation.server";

/**
 * GET /api/v1/tasks/:taskId/runs
 *
 * Returns every Conversation attached to this task (asyncJobId=taskId),
 * ordered by most-recent first. Powers the runs-list view inside the task
 * chat panel for recurring tasks.
 */
export async function loader({ request, params }: LoaderFunctionArgs) {
  const { workspaceId } = await requireUser(request);
  if (!workspaceId) return json({ error: "unauthorized" }, { status: 401 });
  const taskId = params.taskId;
  if (!taskId) return json({ error: "taskId required" }, { status: 400 });

  const task = await prisma.task.findFirst({
    where: { id: taskId, workspaceId: workspaceId as string },
    select: { id: true },
  });
  if (!task) return json({ error: "Not found" }, { status: 404 });

  const runs = await getTaskRuns(taskId, workspaceId as string);
  return json({ runs });
}
