import { json, type ActionFunctionArgs, type LoaderFunctionArgs } from "@remix-run/node";
import { z } from "zod";
import { requireUser } from "~/services/session.server";
import {
  archiveAgent,
  classifyAgent,
  deleteAgent,
  getAgentById,
  readAgentAppearance,
  updateAgent,
  updateGeneralistAgent,
} from "~/services/agent.server";

const PatchBodySchema = z.object({
  displayName: z.string().min(1).max(80).optional(),
  handle: z
    .string()
    .min(2)
    .max(40)
    .regex(/^[a-z][a-z0-9-]*$/)
    .optional(),
  basePrompt: z.string().min(1).max(20_000).optional(),
  personality: z.string().min(1).max(120).optional(),
  appearance: z
    .object({
      eye: z.string().min(1).max(80).optional(),
      eyeColor: z.string().min(1).max(20).optional(),
      accentColor: z.string().min(1).max(20).optional(),
    })
    .optional(),
});

function agentToDto(a: Awaited<ReturnType<typeof getAgentById>>) {
  if (!a) return null;
  return {
    id: a.id,
    handle: a.handle,
    displayName: a.displayName,
    basePrompt: a.basePrompt,
    personality: a.personality,
    capabilities: a.capabilities,
    status: a.status,
    kind: classifyAgent(a),
    gatewayId: a.gatewayId,
    appearance: readAgentAppearance(a),
  };
}

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { workspaceId } = await requireUser(request);
  if (!workspaceId) return json({ error: "unauthorized" }, { status: 401 });
  const agentId = params.agentId;
  if (!agentId) return json({ error: "agentId required" }, { status: 400 });

  const agent = await getAgentById(workspaceId as string, agentId);
  if (!agent) return json({ error: "Not found" }, { status: 404 });

  return json({ agent: agentToDto(agent) });
}

export async function action({ request, params }: ActionFunctionArgs) {
  const { workspaceId } = await requireUser(request);
  if (!workspaceId) return json({ error: "unauthorized" }, { status: 401 });

  const agentId = params.agentId;
  if (!agentId) return json({ error: "agentId required" }, { status: 400 });

  const method = request.method.toUpperCase();

  if (method === "DELETE") {
    const existing = await getAgentById(workspaceId as string, agentId);
    if (!existing) return json({ error: "Not found" }, { status: 404 });
    const kind = classifyAgent(existing);
    if (kind === "system") {
      return json(
        { error: "Cannot delete the generalist agent" },
        { status: 400 },
      );
    }
    if (kind === "gateway") {
      // Archive rather than delete — the gateway lifecycle owns the row.
      await archiveAgent(workspaceId as string, agentId);
      return json({ ok: true });
    }
    await deleteAgent(workspaceId as string, agentId);
    return json({ ok: true });
  }

  if (method === "PATCH") {
    let payload: unknown;
    try {
      payload = await request.json();
    } catch {
      return json({ error: "invalid json" }, { status: 400 });
    }
    const parsed = PatchBodySchema.safeParse(payload);
    if (!parsed.success) {
      return json({ error: parsed.error.message }, { status: 400 });
    }

    const existing = await getAgentById(workspaceId as string, agentId);
    if (!existing) return json({ error: "Not found" }, { status: 404 });
    const kind = classifyAgent(existing);

    // System/gateway agents: name + handle are read-only. Silently drop them
    // rather than 400 so a shared form still saves the appearance/prompt.
    const body = { ...parsed.data };
    if (kind !== "user") {
      delete body.displayName;
      delete body.handle;
    }

    // For the generalist: when the workspace name is what drives displayName,
    // we route through updateGeneralistAgent to keep any workspace sync in one
    // place (currently only appearance + prompt via this endpoint).
    if (kind === "system") {
      const updated = await updateGeneralistAgent(workspaceId as string, {
        basePrompt: body.basePrompt,
        personality: body.personality,
        appearance: body.appearance,
      });
      return json({ agent: agentToDto(updated) });
    }

    const updated = await updateAgent(workspaceId as string, agentId, body);
    return json({ agent: agentToDto(updated) });
  }

  return json({ error: "Method not allowed" }, { status: 405 });
}

