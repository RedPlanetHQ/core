import { json, type ActionFunctionArgs } from "@remix-run/node";
import path from "node:path";
import { z } from "zod";
import { prisma } from "~/db.server";
import { requireUser, getWorkspaceId } from "~/services/session.server";
import { callTool } from "~/services/gateway/transport.server";
import { DELETE_SCRIPT, shEsc } from "~/services/gateway/fs-scripts.server";

const Body = z.object({ path: z.string().min(1) });

interface ExecToolResult {
  command: string;
  dir: string;
  exitCode: number;
  stdout: string;
  stderr?: string;
}

/**
 * POST /api/v1/gateways/:gatewayId/fs/delete
 * body: { path }
 *
 * Removes the given filesystem entry (file or directory, recursive)
 * on the gateway. Folder-scope enforcement on `dir` (the parent of
 * the target) is the only boundary that prevents escapes outside a
 * registered exec folder — never pass a `dir` that hasn't already
 * been validated.
 */
export async function action({ request, params }: ActionFunctionArgs) {
  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, { status: 405 });
  }
  const { gatewayId } = params;
  if (!gatewayId) return json({ error: "Missing gatewayId" }, { status: 400 });

  const user = await requireUser(request);
  const workspaceId = (await getWorkspaceId(
    request,
    user.id,
    user.workspaceId,
  )) as string;

  const gw = await prisma.gateway.findFirst({
    where: { id: gatewayId, workspaceId },
    select: { id: true },
  });
  if (!gw) return json({ error: "Gateway not found" }, { status: 404 });

  const parsed = Body.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return json({ error: parsed.error.message }, { status: 400 });
  }

  const target = parsed.data.path;
  const dir = path.dirname(target);
  const command = `node -e ${shEsc(DELETE_SCRIPT)} ${shEsc(target)}`;

  let result: ExecToolResult;
  try {
    result = (await callTool(gatewayId, "exec_command", {
      command,
      dir,
    })) as ExecToolResult;
  } catch (err) {
    return json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 502 },
    );
  }

  if (result.exitCode !== 0) {
    return json(
      { error: result.stderr?.trim() || `exited ${result.exitCode}` },
      { status: 502 },
    );
  }

  return json({ ok: true });
}
