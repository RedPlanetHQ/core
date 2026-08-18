import { json, type LoaderFunctionArgs } from "@remix-run/node";
import { requireUser } from "~/services/session.server";
import { getAgentById } from "~/services/agent.server";
import { listAgentConversations } from "~/services/conversation.server";

/**
 * GET /api/v1/agents/:agentId/conversations
 * Returns all non-task conversations owned by the agent, one row per source,
 * ordered by most-recent activity. Powers the chat header History popover.
 */
export async function loader({ request, params }: LoaderFunctionArgs) {
  const { workspaceId, id: userId } = await requireUser(request);
  if (!workspaceId || !userId) {
    return json({ error: "unauthorized" }, { status: 401 });
  }
  const agentId = params.agentId;
  if (!agentId) return json({ error: "agentId required" }, { status: 400 });

  const agent = await getAgentById(workspaceId as string, agentId);
  if (!agent) return json({ error: "Not found" }, { status: 404 });

  const conversations = await listAgentConversations(
    workspaceId as string,
    userId as string,
    agentId,
  );

  return json({ conversations });
}
