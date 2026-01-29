/**
 * Raw input from Claude Code hook stdin
 */
export interface RawHookInput {
  session_id?: string;
  cwd?: string;
  prompt?: string;
  tool_name?: string;
  tool_input?: any;
  tool_response?: any;
  transcript_path?: string;
}

/**
 * Normalized hook input with camelCase properties
 */
export interface HookInput {
  sessionId?: string;
  cwd: string;
  prompt?: string;
  toolName?: string;
  toolInput?: any;
  toolResponse?: any;
  transcriptPath?: string;
}
