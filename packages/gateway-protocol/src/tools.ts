import { z } from "zod";

export const ToolCallRequest = z.object({
  id: z.string(),
  tool: z.string(),
  params: z.record(z.string(), z.unknown()),
  timeoutMs: z.number().int().positive().optional(),
});
export type ToolCallRequest = z.infer<typeof ToolCallRequest>;

export const ToolCallResponse = z.object({
  id: z.string(),
  ok: z.boolean(),
  result: z.unknown().optional(),
  error: z.object({ code: z.string(), message: z.string() }).optional(),
});
export type ToolCallResponse = z.infer<typeof ToolCallResponse>;
