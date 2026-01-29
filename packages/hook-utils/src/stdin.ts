import { RawHookInput, HookInput } from "./types";

/**
 * Read and parse JSON from stdin
 */
export async function readJsonFromStdin(): Promise<RawHookInput | undefined> {
  return new Promise((resolve, reject) => {
    let input = "";
    process.stdin.on("data", (chunk) => (input += chunk));
    process.stdin.on("end", () => {
      try {
        resolve(input.trim() ? JSON.parse(input) : undefined);
      } catch (e) {
        reject(new Error(`Failed to parse hook input: ${e}`));
      }
    });
  });
}

/**
 * Normalize raw input from snake_case to camelCase
 */
export function normalizeInput(raw: RawHookInput | undefined): HookInput {
  const r = (raw ?? {}) as any;
  return {
    sessionId: r.session_id,
    cwd: r.cwd ?? process.cwd(),
    prompt: r.prompt,
    toolName: r.tool_name,
    toolInput: r.tool_input,
    toolResponse: r.tool_response,
    transcriptPath: r.transcript_path,
  };
}
