import { json } from "@remix-run/node";
import type { LoaderFunctionArgs } from "@remix-run/node";
import { requireUser, getWorkspaceId } from "~/services/session.server";
import { prisma } from "~/db.server";
import { callGatewayTool } from "../../websocket";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const user = await requireUser(request);
  const workspaceId = (await getWorkspaceId(
    request,
    user.id,
    user.workspaceId,
  )) as string;

  const { sessionId } = params;
  if (!sessionId) return json({ error: "Missing sessionId" }, { status: 400 });

  const session = await prisma.codingSession.findFirst({
    where: { id: sessionId, workspaceId },
    select: {
      externalSessionId: true,
      dir: true,
      gatewayId: true,
    },
  });

  if (!session) return json({ error: "Not found" }, { status: 404 });
  if (!session.gatewayId)
    return json({ error: "No gateway linked" }, { status: 422 });
  if (!session.externalSessionId)
    return json({ error: "No external session ID" }, { status: 422 });

  try {
    const result = await callGatewayTool(
      session.gatewayId,
      "coding_read_session",
      { sessionId: session.externalSessionId },
      30000,
    ) as { success: boolean; result?: { turns?: unknown[]; status?: string; running?: boolean; error?: string }; error?: string };

    if (!result.success) {
      return json({ error: result.error ?? "Tool call failed" }, { status: 502 });
    }

    return json({
      turns: result.result?.turns ?? [],
      status: result.result?.status,
      running: result.result?.running,
      error: result.result?.error,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return json({ error: message }, { status: 502 });
  }
}
