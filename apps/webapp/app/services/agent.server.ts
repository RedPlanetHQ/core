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

/** Defaults mirror SamAvatar defaults so a freshly-seeded agent renders cleanly. */
export const DEFAULT_AGENT_EYE = "bot-pixel-classic";
export const DEFAULT_AGENT_EYE_COLOR = "#74E07A";
export const DEFAULT_AGENT_ACCENT_COLOR = "#c87844";

/**
 * Typed shape for the appearance keys we keep in Agents.metadata.
 * Everything else in metadata (role, gatewaySource, ...) is passed through untouched.
 */
export interface AgentAppearance {
  eye?: string;
  eyeColor?: string;
  accentColor?: string;
}

/** Read appearance keys off an agent, filling in defaults where missing. */
export function readAgentAppearance(agent: Agents): Required<AgentAppearance> {
  const meta = (agent.metadata ?? {}) as Record<string, unknown>;
  return {
    eye: typeof meta.eye === "string" ? meta.eye : DEFAULT_AGENT_EYE,
    eyeColor:
      typeof meta.eyeColor === "string" ? meta.eyeColor : DEFAULT_AGENT_EYE_COLOR,
    accentColor:
      typeof meta.accentColor === "string"
        ? meta.accentColor
        : DEFAULT_AGENT_ACCENT_COLOR,
  };
}

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
  // Voice/personality: built-in id (tars/alfred/hobson/hudson/jeeves) or
  // a custom personality id from the workspace's CustomPersonality table.
  // Defaults handled by the DB column (`"tars"`); omit to accept default.
  personality: z.string().min(1).max(120).optional(),
  gatewayId: z.string().min(1).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});
export type CreateAgentInput = z.infer<typeof CreateAgentInputSchema>;

// Update: gatewayId is immutable once set. Handle can be updated for user/system agents.
export const UpdateAgentInputSchema = z.object({
  handle: AgentHandleSchema.optional(),
  displayName: z.string().min(1).max(80).optional(),
  basePrompt: z.string().min(1).max(20_000).optional(),
  capabilities: z.array(AgentCapabilitySchema).min(1).optional(),
  model: z.string().min(1).max(200).nullable().optional(),
  personality: z.string().min(1).max(120).optional(),
  status: z.nativeEnum(AgentStatus).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  /** Convenience: appearance keys merged into metadata. */
  appearance: z
    .object({
      eye: z.string().min(1).max(80).optional(),
      eyeColor: z.string().min(1).max(20).optional(),
      accentColor: z.string().min(1).max(20).optional(),
    })
    .optional(),
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
      ...(parsed.personality !== undefined
        ? { personality: parsed.personality }
        : {}),
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

  const kind = classifyAgent(existing);

  // Gateway agents: capabilities and model come from the gateway itself.
  if (kind === "gateway") {
    if (parsed.capabilities !== undefined || parsed.model !== undefined) {
      throw new Error("Cannot mutate gateway agent capabilities or model");
    }
    if (parsed.handle !== undefined && parsed.handle !== existing.handle) {
      throw new Error("Cannot change gateway agent handle");
    }
  }

  // Resolve a unique handle if the caller wants to change it.
  let nextHandle: string | undefined;
  if (parsed.handle !== undefined && parsed.handle !== existing.handle) {
    nextHandle = await pickUniqueHandle(workspaceId, parsed.handle);
  }

  // Merge appearance keys into whatever metadata is coming in (or the existing one).
  let nextMetadata: Record<string, unknown> | undefined;
  if (parsed.metadata !== undefined || parsed.appearance !== undefined) {
    const base =
      parsed.metadata !== undefined
        ? { ...parsed.metadata }
        : { ...((existing.metadata ?? {}) as Record<string, unknown>) };
    if (parsed.appearance) {
      if (parsed.appearance.eye !== undefined) base.eye = parsed.appearance.eye;
      if (parsed.appearance.eyeColor !== undefined)
        base.eyeColor = parsed.appearance.eyeColor;
      if (parsed.appearance.accentColor !== undefined)
        base.accentColor = parsed.appearance.accentColor;
    }
    nextMetadata = base;
  }

  return prisma.agents.update({
    where: { id: agentId },
    data: {
      ...(nextHandle !== undefined ? { handle: nextHandle } : {}),
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
      ...(parsed.personality !== undefined
        ? { personality: parsed.personality }
        : {}),
      ...(parsed.status !== undefined ? { status: parsed.status } : {}),
      ...(nextMetadata !== undefined
        ? { metadata: nextMetadata as never }
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

export interface EnsureGeneralistOptions {
  handle?: string;
  appearance?: AgentAppearance;
}

export async function ensureGeneralistAgent(
  workspaceId: string,
  workspaceName: string,
  options: EnsureGeneralistOptions = {},
): Promise<Agents> {
  const existing = await getGeneralistAgent(workspaceId);
  if (existing) return existing;

  const baseHandle = slugifyHandle(options.handle ?? workspaceName);
  const handle = await pickUniqueHandle(workspaceId, baseHandle);

  const metadata: Record<string, unknown> = { role: GENERALIST_ROLE_KEY };
  if (options.appearance?.eye) metadata.eye = options.appearance.eye;
  if (options.appearance?.eyeColor)
    metadata.eyeColor = options.appearance.eyeColor;
  if (options.appearance?.accentColor)
    metadata.accentColor = options.appearance.accentColor;

  return createAgent(workspaceId, {
    handle,
    displayName: workspaceName,
    basePrompt: GENERALIST_BASE_PROMPT,
    capabilities: ["generalist"],
    metadata,
  });
}

export async function updateGeneralistAgent(
  workspaceId: string,
  patch: {
    displayName?: string;
    handle?: string;
    basePrompt?: string;
    personality?: string;
    appearance?: AgentAppearance;
  },
): Promise<Agents> {
  const existing = await getGeneralistAgent(workspaceId);
  if (!existing) throw new Error("Generalist agent not found for workspace");

  const data: Record<string, unknown> = {};
  if (patch.displayName !== undefined) data.displayName = patch.displayName;
  if (patch.basePrompt !== undefined) data.basePrompt = patch.basePrompt;
  if (patch.personality !== undefined) data.personality = patch.personality;
  if (patch.handle !== undefined && patch.handle !== existing.handle) {
    data.handle = await pickUniqueHandle(workspaceId, patch.handle);
  }
  if (patch.appearance) {
    const meta = { ...((existing.metadata ?? {}) as Record<string, unknown>) };
    if (patch.appearance.eye !== undefined) meta.eye = patch.appearance.eye;
    if (patch.appearance.eyeColor !== undefined)
      meta.eyeColor = patch.appearance.eyeColor;
    if (patch.appearance.accentColor !== undefined)
      meta.accentColor = patch.appearance.accentColor;
    data.metadata = meta as never;
  }

  const updated = await prisma.agents.update({
    where: { id: existing.id },
    data,
  });

  // Mirror appearance keys onto the workspace metadata so legacy readers
  // (e.g. SamAvatar's workspace-based fallback, NavUser accentColor prop)
  // stay in sync. The generalist agent is the source of truth; the workspace
  // mirror exists purely for backwards compatibility.
  if (patch.appearance) {
    const ws = await prisma.workspace.findFirst({
      where: { id: workspaceId },
      select: { metadata: true },
    });
    const wsMeta = { ...((ws?.metadata ?? {}) as Record<string, unknown>) };
    if (patch.appearance.eye !== undefined) wsMeta.agentEye = patch.appearance.eye;
    if (patch.appearance.eyeColor !== undefined)
      wsMeta.agentEyeColor = patch.appearance.eyeColor;
    if (patch.appearance.accentColor !== undefined)
      wsMeta.accentColor = patch.appearance.accentColor;
    await prisma.workspace.update({
      where: { id: workspaceId },
      data: { metadata: wsMeta as never },
    });
  }

  return updated;
}

// Gateway-agent lifecycle removed — gateways are workspace
// infrastructure managed under Settings › Gateways, not chatteable
// teammates. If we ever bring them back as agents, restore
// ensureGatewayAgent / archiveGatewayAgent / unarchiveGatewayAgent
// (see git history) and the callers in gateway/register.server.ts and
// gateway/crud.server.ts.
