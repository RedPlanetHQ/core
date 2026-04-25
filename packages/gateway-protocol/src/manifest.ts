import { z } from "zod";
import { Folder } from "./folders.js";

export const PROTOCOL_VERSION = "1";

export const GatewayTool = z.object({
  name: z.string(),
  description: z.string(),
  inputSchema: z.record(z.string(), z.unknown()).optional(),
});

export const Manifest = z.object({
  protocolVersion: z.literal(PROTOCOL_VERSION),
  gateway: z.object({
    id: z.string(),
    name: z.string(),
    version: z.string(),
    platform: z.string(),
    hostname: z.string(),
  }),
  capabilities: z.object({
    browser: z.object({ enabled: z.boolean(), engines: z.array(z.string()).optional() }),
  }),
  folders: z.array(Folder),
  tools: z.array(GatewayTool),
  /** Configured coding agents on this gateway (e.g. "claude-code", "codex-cli"). */
  agents: z.array(z.string()),
});
export type Manifest = z.infer<typeof Manifest>;

export const HealthResponse = z.object({
  status: z.enum(["ok", "degraded"]),
  manifestEtag: z.string(),
  uptimeSec: z.number().int().nonnegative(),
});
export type HealthResponse = z.infer<typeof HealthResponse>;
