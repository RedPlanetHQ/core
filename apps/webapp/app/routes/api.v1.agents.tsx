import { json } from "@remix-run/node";
import { z } from "zod";
import {
  createHybridActionApiRoute,
  createHybridLoaderApiRoute,
} from "~/services/routeBuilders/apiBuilder.server";
import {
  classifyAgent,
  createAgent,
  ensureGeneralistAgent,
  listAgents,
  readAgentAppearance,
  DEFAULT_AGENT_EYE,
  DEFAULT_AGENT_EYE_COLOR,
  DEFAULT_AGENT_ACCENT_COLOR,
} from "~/services/agent.server";
import { getWorkspaceById } from "~/models/workspace.server";
import { SPECIALIST_BASE_PROMPT } from "~/services/agent-prompts";
import { slugifyHandle } from "~/services/agent-slug";
import { prisma } from "~/db.server";

const AgentCapabilities = z.enum([
  "generalist",
  "coding",
  "browser",
  "research",
  "fs",
]);

const CreateBodySchema = z.object({
  displayName: z.string().min(1).max(80),
  handle: z.string().min(2).max(40).optional(),
  basePrompt: z.string().min(1).max(20_000).optional(),
  capabilities: z.array(AgentCapabilities).min(1).optional(),
  personality: z.string().min(1).max(120).optional(),
  appearance: z
    .object({
      eye: z.string().min(1).max(80).optional(),
      eyeColor: z.string().min(1).max(20).optional(),
      accentColor: z.string().min(1).max(20).optional(),
    })
    .optional(),
});

/**
 * GET /api/v1/agents
 * Lists all agents in the workspace (system generalist first, then user, then gateway).
 * Response is shaped for the sidebar and settings UI — includes appearance +
 * classified `kind`.
 */
const loader = createHybridLoaderApiRoute(
  {
    allowJWT: true,
    corsStrategy: "all",
    findResource: async () => 1,
  },
  async ({ authentication }) => {
    if (!authentication.workspaceId) {
      throw new Error("User workspace not found");
    }
    const workspaceId = authentication.workspaceId as string;

    // Make sure every workspace has a generalist — legacy workspaces created
    // before the agents primitive existed won't have one until this seeds it.
    const workspace = await getWorkspaceById(workspaceId);
    if (workspace) {
      await ensureGeneralistAgent(workspaceId, workspace.name);
    }

    const rows = await listAgents(workspaceId);
    const agents = rows.map((a) => ({
      id: a.id,
      handle: a.handle,
      displayName: a.displayName,
      status: a.status,
      kind: classifyAgent(a),
      gatewayId: a.gatewayId,
      capabilities: a.capabilities,
      appearance: readAgentAppearance(a),
    }));
    return json({ agents });
  },
);

/**
 * POST /api/v1/agents
 * Creates a user-authored agent. handle auto-derives from displayName if omitted.
 */
const { action } = createHybridActionApiRoute(
  {
    body: CreateBodySchema,
    method: "POST",
    allowJWT: true,
    corsStrategy: "all",
  },
  async ({ body, authentication }) => {
    if (!authentication.workspaceId) {
      return json({ error: "unauthorized" }, { status: 401 });
    }
    const workspaceId = authentication.workspaceId as string;

    // Resolve handle: use supplied, or slugify the display name. Pick a
    // unique one within the workspace.
    const baseHandle = slugifyHandle(body.handle ?? body.displayName);
    const handle = await pickUnique(workspaceId, baseHandle);

    const metadata: Record<string, unknown> = {};
    metadata.eye = body.appearance?.eye ?? DEFAULT_AGENT_EYE;
    metadata.eyeColor = body.appearance?.eyeColor ?? DEFAULT_AGENT_EYE_COLOR;
    metadata.accentColor =
      body.appearance?.accentColor ?? DEFAULT_AGENT_ACCENT_COLOR;

    const created = await createAgent(workspaceId, {
      handle,
      displayName: body.displayName,
      basePrompt: body.basePrompt ?? SPECIALIST_BASE_PROMPT,
      capabilities: body.capabilities ?? ["generalist"],
      ...(body.personality !== undefined
        ? { personality: body.personality }
        : {}),
      metadata,
    });

    return json({
      agent: {
        id: created.id,
        handle: created.handle,
        displayName: created.displayName,
        status: created.status,
        kind: classifyAgent(created),
        appearance: readAgentAppearance(created),
      },
    });
  },
);

async function pickUnique(workspaceId: string, base: string): Promise<string> {
  for (let n = 1; n < 100; n++) {
    const candidate = n === 1 ? base : `${base}-${n}`;
    const trimmed =
      candidate.length > 40
        ? candidate.slice(0, 40).replace(/-+$/, "")
        : candidate;
    const clash = await prisma.agents.findFirst({
      where: { workspaceId, handle: trimmed },
      select: { id: true },
    });
    if (!clash) return trimmed;
  }
  throw new Error(`Could not find a free handle derived from "${base}"`);
}

export { loader, action };
