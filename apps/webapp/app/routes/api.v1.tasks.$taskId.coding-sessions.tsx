import { json } from "@remix-run/node";
import type { ActionFunctionArgs } from "@remix-run/node";
import { z } from "zod";
import { requireUser, getWorkspaceId } from "~/services/session.server";
import { createCodingSession } from "~/services/coding/coding-session.server";
import { spawnCodingSession } from "~/services/gateway/transport.server";
import { prisma } from "~/db.server";

const CreateSchema = z.object({
  agent: z.string().min(1),
  dir: z.string().min(1),
  gatewayId: z.string().optional(),
  prompt: z.string().optional(),
});

export async function action({ request, params }: ActionFunctionArgs) {
  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, { status: 405 });
  }

  const user = await requireUser(request);
  const workspaceId = (await getWorkspaceId(
    request,
    user.id,
    user.workspaceId,
  )) as string;

  const { taskId } = params;
  if (!taskId) return json({ error: "Missing taskId" }, { status: 400 });

  const body = await request.json().catch(() => ({}));
  const parsed = CreateSchema.safeParse(body);
  if (!parsed.success) {
    return json({ error: parsed.error.message }, { status: 400 });
  }

  // If a gateway is linked, spawn the interactive PTY now so the browser's
  // xterm has something to attach to as soon as the dialog closes. The
  // gateway-returned sessionId is persisted as `externalSessionId`.
  let externalSessionId: string | undefined;
  if (parsed.data.gatewayId) {
    const gw = await prisma.gateway.findFirst({
      where: { id: parsed.data.gatewayId, workspaceId },
      select: { id: true },
    });
    if (!gw) {
      return json({ error: "Gateway not found" }, { status: 404 });
    }
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
      id: session.id,
      agent: session.agent,
      dir: session.dir,
      gatewayId: session.gatewayId,
      externalSessionId: session.externalSessionId,
      createdAt: session.createdAt,
    },
    { status: 201 },
  );
}
