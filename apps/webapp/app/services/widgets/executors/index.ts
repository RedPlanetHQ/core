/**
 * Executor registry — dispatches a widget request by type.
 */

import type { WidgetRequest } from "@core/types";
import type { ExecutorContext, ExecutorResult } from "./types";
import { staticExecutor } from "./static";
import { aiTextExecutor } from "./ai-text";
import { aiStructuredExecutor } from "./ai-structured";
import { integrationActionExecutor } from "./integration-action";
import { internalExecutor } from "./internal";

export async function executeRequest(
  request: WidgetRequest,
  ctx: ExecutorContext,
): Promise<ExecutorResult> {
  switch (request.type) {
    case "static":
      return staticExecutor(request, ctx);
    case "ai.text":
      return aiTextExecutor(request, ctx);
    case "ai.structured":
      return aiStructuredExecutor(request, ctx);
    case "integration_action":
      return integrationActionExecutor(request, ctx);
    case "internal":
      return internalExecutor(request, ctx);
    default: {
      const exhaustive: never = request;
      void exhaustive;
      return {
        ok: false,
        error: `Unknown request type "${(request as { type?: string }).type ?? "?"}"`,
      };
    }
  }
}

export type { ExecutorContext, ExecutorResult } from "./types";
