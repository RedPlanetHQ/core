import type { Processor, ProcessInputArgs } from "@mastra/core/processors";
import { appendFile } from "fs/promises";

/**
 * Recursively walks any JSON value and, wherever an object has a `toolCallId`
 * that matches a key in `overrides`, replaces that object's `args` with the
 * override value.  Works regardless of how deeply the tool call is nested
 * (e.g. inside agent-take_action.result.subAgentToolResults).
 */
export function patchArgsDeep(
  value: unknown,
  overrides: Record<string, Record<string, unknown>>,
): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => patchArgsDeep(item, overrides));
  }
  if (typeof value !== "object" || value === null) return value;

  const obj = value as Record<string, unknown>;

  // Recurse into children first
  const patched: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    patched[k] = patchArgsDeep(v, overrides);
  }

  // If this object has a matching toolCallId, patch its args
  if (typeof obj.toolCallId === "string" && obj.toolCallId in overrides) {
    patched.args = overrides[obj.toolCallId];
  }

  return patched;
}

/**
 * Patches tool call args in Mastra's stored messages to match what the frontend
 * sent (body.messages). This is needed for the approval resume flow: when the user
 * modifies tool call parameters via the ToolUI widget (patchToolCallArgs), those
 * changes live only in the AI SDK UI messages. When approveToolCall resumes, Mastra
 * reloads the original stored messages — without this processor the edits are lost.
 *
 * Usage:
 *   new ToolArgsPatchProcessor(body.messages)
 */
export class ToolArgsPatchProcessor implements Processor {
  readonly id = "tool-args-patch";

  // Map of toolCallId → patched args extracted from the frontend UIMessages
  private readonly patchedArgs: Map<string, Record<string, unknown>>;

  constructor(uiMessages: any[]) {
    this.patchedArgs = new Map();

    for (const msg of uiMessages ?? []) {
      for (const part of msg.parts ?? []) {
        // UI parts that represent tool invocations carry `input` or `args`
        if (
          typeof part.type === "string" &&
          part.type.includes("tool-") &&
          part.toolCallId
        ) {
          const args = part.input ?? part.args;
          if (args && typeof args === "object") {
            this.patchedArgs.set(
              part.toolCallId,
              args as Record<string, unknown>,
            );
          }
        }
      }
    }
  }

  processInput({ messages, messageList }: ProcessInputArgs) {
    if (this.patchedArgs.size === 0) return messages;

    appendFile(
      "/Users/harshithmullapudi/Documents/core/sample_ss.json",
      JSON.stringify(messages),
    );

    appendFile(
      "/Users/harshithmullapudi/Documents/core/sample_ss.json",
      JSON.stringify(this.patchedArgs),
    );

    appendFile(
      "/Users/harshithmullapudi/Documents/core/sample_asdfasdf.json",
      JSON.stringify(messageList),
    );
    return messages.map((msg) => {
      if (msg.role !== "assistant") return msg;

      const parts = (msg.content as any)?.parts;
      if (!Array.isArray(parts)) return msg;

      let changed = false;
      const newParts = parts.map((part: any) => {
        if (part.type !== "tool-call" || !part.toolCallId) return part;
        const patch = this.patchedArgs.get(part.toolCallId);
        if (!patch) return part;
        changed = true;
        return { ...part, args: patch };
      });

      if (!changed) return msg;
      return {
        ...msg,
        content: { ...(msg.content as any), parts: newParts },
      };
    });
  }
}
