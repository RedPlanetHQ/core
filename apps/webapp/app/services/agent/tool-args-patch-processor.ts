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
