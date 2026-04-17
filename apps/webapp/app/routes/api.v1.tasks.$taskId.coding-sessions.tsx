import { json } from "@remix-run/node";
import type { ActionFunctionArgs } from "@remix-run/node";
import { z } from "zod";
import { requireUser, getWorkspaceId } from "~/services/session.server";
import { createCodingSession } from "~/services/coding/coding-session.server";

const CreateSchema = z.object({
  agent: z.string().min(1),
  dir: z.string().optional(),
  gatewayId: z.string().optional(),
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

  const session = await createCodingSession({
    workspaceId,
    userId: user.id,
    taskId,
    agent: parsed.data.agent,
    dir: parsed.data.dir,
    gatewayId: parsed.data.gatewayId,
  });

  return json(
    {
      id: session.id,
      agent: session.agent,
      dir: session.dir,
      createdAt: session.createdAt,
    },
    { status: 201 },
  );
}
