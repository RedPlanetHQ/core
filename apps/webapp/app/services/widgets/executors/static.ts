/**
 * Static executor — returns the value, with templates resolved against scope.
 * Useful for fixtures, defaults, and config-derived constants.
 */

import { evaluateValue } from "~/components/widgets/runtime/expression";
import type { Executor } from "./types";

interface StaticRequest {
  type: "static";
  value: unknown;
}

export const staticExecutor: Executor<StaticRequest> = async (request, ctx) => {
  try {
    return { ok: true, value: evaluateValue(request.value, ctx.scope) };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
};
