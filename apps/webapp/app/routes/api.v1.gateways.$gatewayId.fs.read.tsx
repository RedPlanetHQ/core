import { json, type ActionFunctionArgs } from "@remix-run/node";
import { z } from "zod";
import path from "node:path";
import { prisma } from "~/db.server";
import { requireUser, getWorkspaceId } from "~/services/session.server";
import { callTool } from "~/services/gateway/transport.server";
import {
  READ_DEFAULT_CAP,
  READ_SCRIPT,
  shEsc,
  type FsRead,
} from "~/services/gateway/fs-scripts.server";

const Body = z.object({
  path: z.string().min(1),
  maxBytes: z.number().int().positive().max(READ_DEFAULT_CAP).optional(),
});

interface ExecToolResult {
  command: string;
  dir: string;
  exitCode: number;
  stdout: string;
  stderr?: string;
}

/**
 * POST /api/v1/gateways/:gatewayId/fs/read
 * body: { path, maxBytes? }
 *
 * Reads up to `maxBytes` (capped at READ_DEFAULT_CAP server-side) from
 * a file on the gateway. Uses the inline READ_SCRIPT via the existing
 * `exec_command` tool so we don't have to ship a new gateway release.
 * Folder-scope is enforced on `dir` (the parent directory).
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
  const maxBytes = Math.min(
    parsed.data.maxBytes ?? READ_DEFAULT_CAP,
    READ_DEFAULT_CAP,
  );
  const dir = path.dirname(target);
  const command = `node -e ${shEsc(READ_SCRIPT)} ${shEsc(target)} ${maxBytes}`;

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

  let read: FsRead;
  try {
    read = JSON.parse(result.stdout) as FsRead;
  } catch {
    return json(
      { error: "Gateway returned invalid JSON from read script" },
      { status: 502 },
    );
  }

  return json({ read });
}
