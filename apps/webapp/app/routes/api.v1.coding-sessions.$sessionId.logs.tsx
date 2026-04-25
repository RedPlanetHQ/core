import { json } from "@remix-run/node";
import type { LoaderFunctionArgs } from "@remix-run/node";
import { requireUser, getWorkspaceId } from "~/services/session.server";
import { prisma } from "~/db.server";
import { callTool } from "~/services/gateway/transport.server";

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
    const result = (await callTool(
      session.gatewayId,
      "coding_read_session",
      { sessionId: session.externalSessionId },
      30000,
    )) as {
      turns?: unknown[];
      status?: string;
      running?: boolean;
      error?: string;
    };

    const rawTurns = (result.turns ?? []) as Array<{
      role: string;
      content: string;
    }>;

    const turns = rawTurns.filter((turn) => {
      const content =
        typeof turn.content === "string" ? turn.content : String(turn.content);
      if (content.includes("<local-command-caveat>")) return false;
      if (content.includes("<command-name>")) return false;
      if (content.includes("<command-message>")) return false;
      if (content.includes("Base directory for this skill:")) return false;
      return true;
    });

    return json({
      turns,
      status: result.status,
      running: result.running,
      error: result.error,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return json({ error: message }, { status: 502 });
  }
}
