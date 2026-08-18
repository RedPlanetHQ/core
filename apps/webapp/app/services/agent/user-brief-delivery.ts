/**
 * buzz-acp-style delivery for OpenAI-compat BYOK endpoints.
 *
 * When the workspace routes through a proxy that fronts an agent with
 * its own baked identity (cliproxy, Claude Code as an OpenAI-compat
 * endpoint, similar CLI-agent wrappers), sending our CORE prompt as
 * `system` fails — the upstream agent's own system prompt sits above
 * ours and asserts its own identity. Empirically: `system` delivery
 * against cliproxy gets responses like "I'm Claude Code" that ignore
 * our gateway list and routing rules entirely; the user-brief pattern
 * below gets the model to actually read `[Context]` and follow them.
 *
 * This helper folds the whole system prompt + message history into a
 * single `role: "user"` message (an "assignment brief"). The upstream
 * agent keeps its own identity and treats our content as the task to
 * work on for this turn — mirrors exactly how buzz-acp spawns
 * claude-code via ACP.
 *
 * Trade-offs:
 * - The upstream agent won't literally role-play as the CORE agent's
 *   display name, but WILL follow our routing / discipline / gateway
 *   rules for the turn.
 * - Token cost per turn is higher (no separate system block for the
 *   provider's prompt caching to key on). Anthropic user-content
 *   caching can still key on the stable brief head — a later
 *   optimization when it matters.
 * - The model no longer sees explicit role alternation — the history
 *   arrives as `[role]: content` labels inline. Buzz shows this works
 *   fine at scale; speaker attribution is preserved via the `[Cass] …`
 *   prefixes we already stamp.
 */

import type { MessageListInput } from "@mastra/core/agent/message-list";

interface BuildUserBriefParams {
  systemPrompt: string;
  modelMessages: MessageListInput;
}

interface BuildUserBriefResult {
  systemPrompt: string;
  modelMessages: MessageListInput;
}

export function buildUserBrief(
  params: BuildUserBriefParams,
): BuildUserBriefResult {
  const { systemPrompt, modelMessages } = params;
  const messages = modelMessages as Array<{
    role?: string;
    content?: unknown;
  }>;

  const lastIdx = messages.length - 1;
  const last = messages[lastIdx];

  const historyLines: string[] = [];
  for (let i = 0; i < lastIdx; i++) {
    const m = messages[i];
    historyLines.push(`[${i}] ${m?.role ?? "?"}: ${flattenContent(m?.content)}`);
  }

  const parts: string[] = [];
  parts.push(
    "You are being invoked as an agent inside CORE. The block below is your operating context and instructions for this turn — follow them for how you route, delegate, and communicate.",
  );
  parts.push("");
  parts.push("===== BEGIN CORE OPERATING CONTEXT =====");
  parts.push(systemPrompt);
  parts.push("===== END CORE OPERATING CONTEXT =====");

  if (historyLines.length > 0) {
    parts.push("");
    parts.push("===== CONVERSATION HISTORY (older → newer) =====");
    parts.push(historyLines.join("\n"));
    parts.push("===== END CONVERSATION HISTORY =====");
  }

  parts.push("");
  parts.push(
    `The latest message in the thread (role=${last?.role ?? "?"}) — reply to this:`,
  );
  parts.push("");
  parts.push(flattenContent(last?.content));

  const brief = parts.join("\n");

  return {
    systemPrompt: "",
    modelMessages: [
      { role: "user", content: brief },
    ] as unknown as MessageListInput,
  };
}

/**
 * True when the resolved model config is a concrete AI-SDK language
 * model instance — i.e. the branch in `resolveModelConfig` that fires
 * for OpenAI-BYOK with a custom baseURL (cliproxy, Vercel AI Gateway,
 * any CLI-agent proxy). Mastra's router pattern returns a string or a
 * `{ id, apiKey }` config for other cases; the concrete LM instance is
 * ONLY constructed for the OpenAI-compat proxy path today.
 *
 * We identify it by shape: AI-SDK language models expose the internal
 * `doGenerate` / `doStream` methods that the Mastra Agent calls. If
 * either exists on the config, we're on the openai-compat proxy path
 * and need user-brief delivery to survive the upstream agent's baked
 * identity.
 */
export function shouldUseUserBriefDelivery(modelConfig: unknown): boolean {
  if (typeof modelConfig !== "object" || modelConfig === null) return false;
  const cfg = modelConfig as Record<string, unknown>;
  return typeof cfg.doGenerate === "function" || typeof cfg.doStream === "function";
}

/**
 * Flatten a Mastra/AI-SDK content field into plain text. Handles
 * strings, arrays of text parts, and tool-call parts (rendered as a
 * compact JSON one-liner so the model can still see them in-line).
 * Non-text parts fall back to their JSON to avoid dropping information
 * silently.
 */
function flattenContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return safeJson(content);
  const chunks: string[] = [];
  for (const p of content) {
    if (!p || typeof p !== "object") {
      chunks.push(String(p));
      continue;
    }
    const part = p as {
      type?: string;
      text?: unknown;
      toolName?: string;
      toolCallId?: string;
      input?: unknown;
      output?: unknown;
    };
    if (part.type === "text" && typeof part.text === "string") {
      chunks.push(part.text);
    } else if (
      typeof part.type === "string" &&
      (part.type.startsWith("tool-") || part.type === "tool-call")
    ) {
      const label = part.toolName ? ` ${part.toolName}` : "";
      chunks.push(`<${part.type}${label}> input=${safeJson(part.input)}`);
    } else if (part.type === "tool-result") {
      chunks.push(`<tool-result> output=${safeJson(part.output)}`);
    } else {
      chunks.push(safeJson(part));
    }
  }
  return chunks.join("\n");
}

function safeJson(v: unknown): string {
  try {
    const s = JSON.stringify(v);
    if (s === undefined) return String(v);
    return s.length > 2000 ? `${s.slice(0, 2000)}… <truncated>` : s;
  } catch {
    return "<unserializable>";
  }
}
