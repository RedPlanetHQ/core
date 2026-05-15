import { json, type ActionFunctionArgs } from "@remix-run/node";
import { z } from "zod";

import { prisma } from "~/db.server";
import { requireUser, getWorkspaceId } from "~/services/session.server";
import { createTask } from "~/services/task.server";
import { createCodingSession } from "~/services/coding/coding-session.server";
import { spawnCodingSession } from "~/services/gateway/transport.server";

const UNTITLED_TITLE = "Untitled session";

const BodySchema = z.object({
  gatewayId: z.string().min(1),
  agent: z.string().min(1),
  dir: z.string().min(1),
  /// When set, attach the new coding session to this existing task instead
  /// of creating a stub. Used by the task page's "New session" dialog.
  taskId: z.string().min(1).optional(),
  /// Initial prompt to send into the session terminal. Optional.
  prompt: z.string().optional(),
});

/**
 * POST /api/v1/coding-sessions/new
 *
 * Single entry point for creating a coding session.
 *   - No `taskId`  → create a stub Task ("Untitled session") and link.
 *                    Title + description fill in via the gateway's
 *                    turn_ended events.
 *   - With taskId  → attach the new session to that task.
 *
 * Spawn-then-create order: we spawn the PTY first so a gateway failure
 * surfaces before we leave a dangling empty task.
 */
export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, { status: 405 });
  }

  const user = await requireUser(request);
  const workspaceId = (await getWorkspaceId(
    request,
    user.id,
    user.workspaceId,
  )) as string;

  const body = await request.json().catch(() => ({}));
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return json({ error: parsed.error.message }, { status: 400 });
  }

  const gateway = await prisma.gateway.findFirst({
    where: { id: parsed.data.gatewayId, workspaceId },
    select: { id: true },
  });
  if (!gateway) {
    return json({ error: "Gateway not found" }, { status: 404 });
  }

  // Resolve the task up-front so we 404 before spawning when an explicit
  // taskId is bad. The stub-task path defers creation until after the
  // spawn so a gateway failure doesn't leave a dangling task.
  let existingTaskId: string | null = null;
  if (parsed.data.taskId) {
    const task = await prisma.task.findFirst({
      where: { id: parsed.data.taskId, workspaceId },
      select: { id: true },
    });
    if (!task) {
      return json({ error: "Task not found" }, { status: 404 });
    }
    existingTaskId = task.id;
  }

  let externalSessionId: string;
  try {
    const spawn = await spawnCodingSession(parsed.data.gatewayId, {
      agent: parsed.data.agent,
      dir: parsed.data.dir,
    });
    externalSessionId = spawn.sessionId;
  } catch (err) {
    return json(
      {
        error:
          err instanceof Error ? err.message : "failed to spawn on gateway",
      },
      { status: 502 },
    );
  }

  let taskId: string;
  if (existingTaskId) {
    taskId = existingTaskId;
  } else {
    // status = "Working" skips the 2-min buffer wake-up that createTask
    // schedules for Todo tasks — the user drives the terminal directly.
    const stub = await createTask(
      workspaceId,
      user.id,
      UNTITLED_TITLE,
      undefined,
      { status: "Working", source: "coding-session" },
    );
    taskId = stub.id;
  }

  const session = await createCodingSession({
    workspaceId,
    userId: user.id,
    taskId,
    agent: parsed.data.agent,
    dir: parsed.data.dir,
    gatewayId: parsed.data.gatewayId,
    externalSessionId,
    prompt: parsed.data.prompt,
  });

  return json(
    {
      task: { id: taskId },
      session: {
        id: session.id,
        externalSessionId,
        agent: session.agent,
        dir: session.dir,
        gatewayId: session.gatewayId,
      },
    },
    { status: 201 },
  );
}
