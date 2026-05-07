/**
 * integration_action executor — proxies to the existing integration handler.
 *
 * Resolves `integration: "github"` (slug from the IR) to the user's connected
 * account id, evaluates templated params against the scope, and calls
 * `handleExecuteIntegrationAction` — the same handler the gateway and the
 * `/api/v1/integration_account/:id/action` route use. No duplicated logic;
 * this executor is a thin dispatcher above existing infra.
 */

import { evaluateValue } from "~/components/widgets/runtime/expression";
import { handleExecuteIntegrationAction } from "~/utils/mcp/integration-operations";
import { IntegrationLoader } from "~/utils/mcp/integration-loader";
import type { Executor } from "./types";

interface IntegrationActionRequest {
  type: "integration_action";
  integration: string;
  action: string;
  params?: Record<string, unknown>;
}

export const integrationActionExecutor: Executor<
  IntegrationActionRequest
> = async (request, ctx) => {
  try {
    // Resolve integration slug → account id for the calling user.
    const accounts = await IntegrationLoader.getConnectedIntegrationAccounts(
      ctx.userId,
      ctx.workspaceId,
    );
    const account = accounts.find(
      (a) => a.integrationDefinition.slug === request.integration,
    );
    if (!account) {
      return {
        ok: false,
        error: `Integration "${request.integration}" not connected for this user.`,
      };
    }

    // Evaluate templated params against (config + state + earlier requests).
    const parameters = request.params
      ? (evaluateValue(request.params, ctx.scope) as Record<string, unknown>)
      : {};

    // Reuse the existing handler — same path orchestrator + gateway use.
    const result = await handleExecuteIntegrationAction({
      accountId: account.id,
      action: request.action,
      parameters,
      source: "widget",
      userId: ctx.userId,
    });

    return { ok: true, value: unwrapMcpContent(result) };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
};

/**
 * Integration handlers return MCP-style envelopes ({ content: [{ text }], isError })
 * for some flows. Unwrap when present so widgets see typed JSON, not the wrapper.
 */
function unwrapMcpContent(result: unknown): unknown {
  if (
    !result ||
    typeof result !== "object" ||
    !("content" in (result as Record<string, unknown>))
  ) {
    return result;
  }
  const content = (result as { content?: unknown }).content;
  if (!Array.isArray(content) || content.length === 0) return result;
  const first = content[0] as { text?: string };
  if (typeof first.text !== "string") return result;
  // Try to parse as JSON; fall back to raw string.
  try {
    return JSON.parse(first.text);
  } catch {
    return first.text;
  }
}
