import { z } from "zod";
import { AgentStatus, type Agents } from "@core/database";
import { prisma } from "~/db.server";
import { GENERALIST_BASE_PROMPT } from "~/services/agent-prompts";
import { slugifyHandle } from "~/services/agent-slug";

// -----------------------------------------------------------------------------
// Sentinels & enums
// -----------------------------------------------------------------------------

/** Stored in Agents.metadata.role to identify the workspace's generalist. */
export const GENERALIST_ROLE_KEY = "generalist" as const;

export const AgentCapabilitySchema = z.enum([
  "generalist",
  "coding",
  "browser",
  "research",
  "fs",
]);
export type AgentCapability = z.infer<typeof AgentCapabilitySchema>;

// -----------------------------------------------------------------------------
// Zod input schemas
// -----------------------------------------------------------------------------

const AgentHandleSchema = z
  .string()
  .min(2)
  .max(40)
  .regex(
    /^[a-z][a-z0-9-]*$/,
    "handle must be lowercase slug starting with a letter",
  );

export const CreateAgentInputSchema = z.object({
  handle: AgentHandleSchema,
  displayName: z.string().min(1).max(80),
  basePrompt: z.string().min(1).max(20_000),
  capabilities: z.array(AgentCapabilitySchema).min(1),
  model: z.string().min(1).max(200).optional(),
  gatewayId: z.string().min(1).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});
export type CreateAgentInput = z.infer<typeof CreateAgentInputSchema>;

// Update: handle and gatewayId are immutable once set.
export const UpdateAgentInputSchema = z.object({
  displayName: z.string().min(1).max(80).optional(),
  basePrompt: z.string().min(1).max(20_000).optional(),
  capabilities: z.array(AgentCapabilitySchema).min(1).optional(),
  model: z.string().min(1).max(200).nullable().optional(),
  status: z.nativeEnum(AgentStatus).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});
export type UpdateAgentInput = z.infer<typeof UpdateAgentInputSchema>;

// -----------------------------------------------------------------------------
// Kind classification (derived — no enum column)
// -----------------------------------------------------------------------------

export type AgentKind = "system" | "gateway" | "user";

/**
 * Classify an agent by its persistent fields.
 * - gatewayId != null → gateway (auto-managed by gateway lifecycle)
 * - metadata.role == "generalist" → system (workspace generalist)
 * - otherwise → user-created
 */
export function classifyAgent(agent: Agents): AgentKind {
  if (agent.gatewayId) return "gateway";
  const role = (agent.metadata as { role?: string } | null)?.role;
  if (role === GENERALIST_ROLE_KEY) return "system";
  return "user";
}

// -----------------------------------------------------------------------------
// CRUD
// -----------------------------------------------------------------------------

export async function createAgent(
  workspaceId: string,
  input: CreateAgentInput,
): Promise<Agents> {
  const parsed = CreateAgentInputSchema.parse(input);
  return prisma.agents.create({
    data: {
      workspaceId,
      handle: parsed.handle,
      displayName: parsed.displayName,
      basePrompt: parsed.basePrompt,
      capabilities: parsed.capabilities,
      model: parsed.model ?? null,
      status: AgentStatus.Active,
      gatewayId: parsed.gatewayId ?? null,
      metadata: (parsed.metadata ?? {}) as never,
    },
  });
}

export async function getAgentById(
  workspaceId: string,
  agentId: string,
): Promise<Agents | null> {
  return prisma.agents.findFirst({ where: { id: agentId, workspaceId } });
}

export async function getAgentByHandle(
  workspaceId: string,
  handle: string,
): Promise<Agents | null> {
  return prisma.agents.findFirst({ where: { workspaceId, handle } });
}

export async function getAgentByGatewayId(
  workspaceId: string,
  gatewayId: string,
): Promise<Agents | null> {
  return prisma.agents.findFirst({ where: { workspaceId, gatewayId } });
}

export async function getGeneralistAgent(
  workspaceId: string,
): Promise<Agents | null> {
  return prisma.agents.findFirst({
    where: {
      workspaceId,
      metadata: { path: ["role"], equals: GENERALIST_ROLE_KEY } as never,
    },
  });
}

export async function listAgents(
  workspaceId: string,
  opts: { status?: AgentStatus } = {},
): Promise<Agents[]> {
  const rows = await prisma.agents.findMany({
    where: {
      workspaceId,
      ...(opts.status ? { status: opts.status } : {}),
    },
    orderBy: { displayName: "asc" },
  });
  // Sort: system generalist first, then user-created, then gateway agents.
  const rank: Record<AgentKind, number> = { system: 0, user: 1, gateway: 2 };
  return rows.sort((a, b) => rank[classifyAgent(a)] - rank[classifyAgent(b)]);
}

export async function updateAgent(
  workspaceId: string,
  agentId: string,
  input: UpdateAgentInput,
): Promise<Agents> {
  const existing = await getAgentById(workspaceId, agentId);
  if (!existing) throw new Error("Agent not found");
  const parsed = UpdateAgentInputSchema.parse(input);

  // Gateway agents: capabilities and model come from the gateway itself.
  if (classifyAgent(existing) === "gateway") {
    if (parsed.capabilities !== undefined || parsed.model !== undefined) {
      throw new Error(
        "Cannot mutate gateway agent capabilities or model",
      );
    }
  }

  return prisma.agents.update({
    where: { id: agentId },
    data: {
      ...(parsed.displayName !== undefined
        ? { displayName: parsed.displayName }
        : {}),
      ...(parsed.basePrompt !== undefined
        ? { basePrompt: parsed.basePrompt }
        : {}),
      ...(parsed.capabilities !== undefined
        ? { capabilities: parsed.capabilities }
        : {}),
      ...(parsed.model !== undefined ? { model: parsed.model } : {}),
      ...(parsed.status !== undefined ? { status: parsed.status } : {}),
      ...(parsed.metadata !== undefined
        ? { metadata: parsed.metadata as never }
        : {}),
    },
  });
}

export async function archiveAgent(
  workspaceId: string,
  agentId: string,
): Promise<Agents> {
  const existing = await getAgentById(workspaceId, agentId);
  if (!existing) throw new Error("Agent not found");
  if (classifyAgent(existing) === "system") {
    throw new Error("Cannot mutate system agent");
  }
  return prisma.agents.update({
    where: { id: agentId },
    data: { status: AgentStatus.Archived },
  });
}

export async function deleteAgent(
  workspaceId: string,
  agentId: string,
): Promise<void> {
  const existing = await getAgentById(workspaceId, agentId);
  if (!existing) throw new Error("Agent not found");
  const kind = classifyAgent(existing);
  if (kind === "system") {
    throw new Error("Cannot mutate system agent");
  }
  if (kind === "gateway") {
    throw new Error(
      "Cannot mutate gateway agent — delete the gateway instead",
    );
  }
  await prisma.agents.delete({ where: { id: agentId } });
}

// -----------------------------------------------------------------------------
// Handle uniqueness helper
// -----------------------------------------------------------------------------

/**
 * Pick a handle unique within (workspaceId). Tries the base first, then
 * appends -2, -3, ... up to -99. Truncates to 40 chars if the suffix pushes over.
 */
async function pickUniqueHandle(
  workspaceId: string,
  base: string,
): Promise<string> {
  for (let n = 1; n < 100; n++) {
    const candidate = n === 1 ? base : `${base}-${n}`;
    const trimmed =
      candidate.length > 40 ? candidate.slice(0, 40).replace(/-+$/, "") : candidate;
    const existing = await getAgentByHandle(workspaceId, trimmed);
    if (!existing) return trimmed;
  }
  throw new Error(`Could not find a free handle derived from "${base}"`);
}

// -----------------------------------------------------------------------------
// Generalist seed + rename
// -----------------------------------------------------------------------------

export async function ensureGeneralistAgent(
  workspaceId: string,
  workspaceName: string,
): Promise<Agents> {
  const existing = await getGeneralistAgent(workspaceId);
  if (existing) return existing;

  const baseHandle = slugifyHandle(workspaceName);
  const handle = await pickUniqueHandle(workspaceId, baseHandle);

  return createAgent(workspaceId, {
    handle,
    displayName: workspaceName,
    basePrompt: GENERALIST_BASE_PROMPT,
    capabilities: ["generalist"],
    metadata: { role: GENERALIST_ROLE_KEY },
  });
}

export async function updateGeneralistAgent(
  workspaceId: string,
  patch: { displayName?: string; handle?: string; basePrompt?: string },
): Promise<Agents> {
  const existing = await getGeneralistAgent(workspaceId);
  if (!existing) throw new Error("Generalist agent not found for workspace");

  const data: Record<string, unknown> = {};
  if (patch.displayName !== undefined) data.displayName = patch.displayName;
  if (patch.basePrompt !== undefined) data.basePrompt = patch.basePrompt;
  if (patch.handle !== undefined && patch.handle !== existing.handle) {
    data.handle = await pickUniqueHandle(workspaceId, patch.handle);
  }

  return prisma.agents.update({
    where: { id: existing.id },
    data,
  });
}

// -----------------------------------------------------------------------------
// Gateway agent lifecycle
// -----------------------------------------------------------------------------

export interface GatewayAgentSeedInput {
  id: string;
  workspaceId: string;
  name: string;
  description?: string | null;
}

function buildGatewayBasePrompt(input: GatewayAgentSeedInput): string {
  const desc = input.description?.trim();
  return `You are the "${input.name}" gateway agent inside CORE — a locally-installed gateway ${
    desc
      ? `described as: ${desc}`
      : "connected to the user's environment"
  }.

You expose the gateway's tools (coding sessions, browser control, file access) to the workspace. When another agent or the user assigns you a task, complete it using the gateway's capabilities. Report progress in the task thread. If the gateway becomes disconnected, say so and stop.`;
}

export async function ensureGatewayAgent(
  input: GatewayAgentSeedInput,
): Promise<Agents> {
  const existing = await getAgentByGatewayId(input.workspaceId, input.id);
  if (existing) return existing;

  const baseHandle = slugifyHandle(input.name);
  const handle = await pickUniqueHandle(input.workspaceId, baseHandle);

  return createAgent(input.workspaceId, {
    handle,
    displayName: input.name,
    basePrompt: buildGatewayBasePrompt(input),
    capabilities: ["coding", "browser", "fs"],
    gatewayId: input.id,
    metadata: { gatewaySource: true },
  });
}

export async function archiveGatewayAgent(gatewayId: string): Promise<void> {
  await prisma.agents.updateMany({
    where: { gatewayId },
    data: { status: AgentStatus.Archived },
  });
}

export async function unarchiveGatewayAgent(gatewayId: string): Promise<void> {
  await prisma.agents.updateMany({
    where: { gatewayId },
    data: { status: AgentStatus.Active },
  });
}
