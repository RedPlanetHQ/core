import { z } from "zod";
import { Folder } from "./folders.js";
import { WorkflowsBlock, PluginSkill } from "./workflows.js";

export const PROTOCOL_VERSION = "1";

export const GatewayTool = z.object({
  name: z.string(),
  description: z.string(),
  inputSchema: z.record(z.string(), z.unknown()).optional(),
});

export const GatewaySkill = z.object({
  /** Folder name and frontmatter `name` (must match). Kebab-case slug. */
  name: z.string(),
  /** Short one-liner shown in the agent system prompt and the UI. */
  description: z.string(),
  /** Frontmatter `allowed-tools`. Read for UI display only in v1; no runtime enforcement. */
  allowedTools: z.array(z.string()).optional(),
  /** Absolute path to the skill directory on the gateway host. Used to construct `SKILL.md` reads. */
  path: z.string(),
});
export type GatewaySkill = z.infer<typeof GatewaySkill>;

/**
 * A coding agent binary the gateway has detected on its `PATH` but not yet
 * configured in `preferences.coding`. The webapp uses this to surface
 * "Configure + Log in" actions for agents the user has installed.
 */
export const AvailableAgent = z.object({
  name: z.string(),       // e.g. "claude-code"
  command: z.string(),    // e.g. "claude"
  path: z.string(),       // absolute path resolved via `which`
  configured: z.boolean(), // already present in `preferences.coding`
});
export type AvailableAgent = z.infer<typeof AvailableAgent>;

/**
 * How this gateway was deployed. UI uses it to gate features (e.g. only
 * container-based gateways get a "Clone repo" folder option, since laptop
 * gateways already have the user's repos on disk). `railway` is a
 * container deploy with a single mounted volume at /mnt/volume.
 */
export const DeployMode = z.enum(["native", "docker", "railway"]);
export type DeployMode = z.infer<typeof DeployMode>;

export const Manifest = z.object({
  protocolVersion: z.literal(PROTOCOL_VERSION),
  gateway: z.object({
    id: z.string(),
    name: z.string(),
    description: z.string().optional(),
    version: z.string(),
    platform: z.string(),
    hostname: z.string(),
    deployMode: DeployMode.default("native"),
  }),
  capabilities: z.object({
    browser: z.object({ enabled: z.boolean(), engines: z.array(z.string()).optional() }),
    /**
     * Whether the gateway accepts short-lived HMAC tickets on its xterm
     * WebSocket so the browser can connect directly without proxying through
     * the webapp. Omitted on older gateways — webapp must fall back to the
     * proxy path in that case.
     */
    directXterm: z.boolean().optional(),
  }),
  folders: z.array(Folder),
  tools: z.array(GatewayTool),
  /** Skills installed on the gateway. Bodies are NOT included — read SKILL.md via files_read on demand. */
  skills: z.array(GatewaySkill).default([]),
  /** Configured coding agents on this gateway (e.g. "claude-code", "codex-cli"). */
  agents: z.array(z.string()),
  /** Detected agent binaries (configured or not). Used by the "Log in" UI. */
  availableAgents: z.array(AvailableAgent).default([]),
  /** Resolved coding workflow templates per agent. */
  workflows: WorkflowsBlock.optional(),
  /** Plugin slash commands detected on the host, per agent. */
  pluginSkills: z.array(PluginSkill).default([]),
});
export type Manifest = z.infer<typeof Manifest>;

export const HealthResponse = z.object({
  status: z.enum(["ok", "degraded"]),
  manifestEtag: z.string(),
  uptimeSec: z.number().int().nonnegative(),
});
export type HealthResponse = z.infer<typeof HealthResponse>;
