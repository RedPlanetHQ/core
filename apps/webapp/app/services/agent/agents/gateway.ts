/**
 * Gateway Agent Factory
 *
 * Gateway tool helpers — converts gateway JSON schema tools into AI SDK tools
 * that are registered directly on the core agent (not via the orchestrator).
 */

import { Agent } from "@mastra/core/agent";
import { createTool } from "@mastra/core/tools";
import { z } from "zod";

import { createCodingSession } from "~/services/coding/coding-session.server";
import { createBrowserSession } from "~/services/browser/browser-session.server";

import { logger } from "~/services/logger.service";
import { getGateway } from "~/services/gateway.server";
import { toRouterString } from "~/lib/model.server";
import { getDefaultChatModelId } from "~/services/llm-provider.server";
import {
  type OrchestratorTools,
  type GatewayAgentInfo,
} from "../executors/base";
import {
  callTool as callGatewayTool,
  fetchManifest,
} from "~/services/gateway/transport.server";
import type { Folder } from "@redplanethq/gateway-protocol";

// Types for gateway tools (matches schema in database)
interface GatewayTool {
  name: string;
  description: string;
  inputSchema?: {
    type?: string;
    properties?: Record<string, JsonSchemaProperty>;
    required?: string[];
  };
}

interface JsonSchemaProperty {
  type?: string;
  description?: string;
  items?: { type?: string };
  default?: unknown;
}

/**
 * Convert a JSON Schema property to a Zod schema
 */
export function jsonSchemaPropertyToZod(prop: JsonSchemaProperty): any {
  switch (prop.type) {
    case "string":
      return z.string().describe(prop.description || "");
    case "number":
      return z.number().describe(prop.description || "");
    case "boolean":
      return z.boolean().describe(prop.description || "");
    case "array":
      if (prop.items?.type === "string") {
        return z.array(z.string()).describe(prop.description || "");
      }
      return z.array(z.unknown()).describe(prop.description || "");
    case "object":
      return z.record(z.string(), z.unknown()).describe(prop.description || "");
    default:
      return z.unknown().describe(prop.description || "");
  }
}

/**
 * Convert a gateway tool's JSON Schema to a Zod object schema
 */
export function gatewayToolToZodSchema(
  gatewayTool: GatewayTool,
): z.ZodObject<Record<string, any>> {
  const schema = gatewayTool.inputSchema;
  if (!schema || !schema.properties) {
    return z.object({});
  }

  const shape: Record<string, any> = {};
  const required = schema.required || [];

  for (const [key, prop] of Object.entries(schema.properties)) {
    let zodProp = jsonSchemaPropertyToZod(prop);
    if (!required.includes(key)) {
      zodProp = zodProp.optional();
    }
    shape[key] = zodProp;
  }

  return z.object(shape);
}

const APPROVAL_REQUIRED_PATTERNS = [
  /^coding_ask$/i,
  /^exec_/i,
  /^files_(edit|write)$/i,
];

function requiresApproval(toolName: string): boolean {
  return APPROVAL_REQUIRED_PATTERNS.some((p) => p.test(toolName));
}

/**
 * Create Mastra tools from a gateway's tool definitions.
 * Each gateway tool becomes a Mastra createTool() with proper Zod schema.
 */
interface SessionContext {
  conversationId?: string;
  taskId?: string;
  workspaceId: string;
  userId: string;
}

function createGatewayTools(
  gatewayId: string,
  gatewayTools: GatewayTool[],
  executorTools?: OrchestratorTools,
  interactive: boolean = true,
  sessionCtx?: SessionContext,
) {
  const tools: Record<string, any> = {};

  for (const gatewayTool of gatewayTools) {
    const zodSchema = gatewayToolToZodSchema(gatewayTool);

    tools[gatewayTool.name] = createTool({
      id: gatewayTool.name,
      description: gatewayTool.description,
      inputSchema: zodSchema,
      requireApproval: interactive && requiresApproval(gatewayTool.name),
      execute: async (params) => {
        try {
          logger.info(
            `GatewayAgent: Executing ${gatewayId}/${gatewayTool.name} with params: ${JSON.stringify(params)}`,
          );

          // Handle sleep server-side instead of forwarding to gateway CLI
          if (gatewayTool.name === "sleep") {
            const { seconds } = params as { seconds: number; reason?: string };
            await new Promise<void>((resolve) =>
              setTimeout(resolve, seconds * 1000),
            );
            return JSON.stringify({ waited: seconds });
          }

          const result = executorTools
            ? await executorTools.executeGatewayTool(
                gatewayId,
                gatewayTool.name,
                params as Record<string, unknown>,
              )
            : await callGatewayTool(
                gatewayId,
                gatewayTool.name,
                params as Record<string, unknown>,
                60000,
              );

          // Record a BrowserSession row when the agent successfully creates a
          // session alias on the gateway. The row is the workspace-side audit
          // trail; the gateway already persisted the alias in its config.
          if (
            gatewayTool.name === "browser_create_session" &&
            sessionCtx?.taskId
          ) {
            const p = params as Record<string, unknown>;
            const sessionName = p.session as string | undefined;
            const profileName = p.profile as string | undefined;
            if (sessionName && profileName) {
              createBrowserSession({
                workspaceId: sessionCtx.workspaceId,
                taskId: sessionCtx.taskId,
                gatewayId,
                sessionName,
                profileName,
              }).catch((err) =>
                logger.warn("Failed to record browser session", { err }),
              );
            }
          }

          // Record coding session only on successful coding_ask (result has sessionId)
          if (gatewayTool.name === "coding_ask" && sessionCtx) {
            const r = result as Record<string, unknown>;
            if (r.sessionId) {
              const p = params as Record<string, unknown>;
              createCodingSession({
                workspaceId: sessionCtx.workspaceId,
                userId: sessionCtx.userId,
                taskId: sessionCtx.taskId,
                conversationId: sessionCtx.conversationId,
                gatewayId,
                agent: (p.agent as string) ?? "claude-code",
                prompt: p.prompt as string | undefined,
                dir: p.dir as string | undefined,
                externalSessionId: r.sessionId as string,
                worktreePath: r.worktreePath as string | undefined,
                worktreeBranch: r.worktreeBranch as string | undefined,
              }).catch((err) =>
                logger.warn("Failed to record coding session", { err }),
              );
            }
          }

          const r = result as Record<string, unknown>;
          if (r?.screenshot && typeof r.screenshot === "string" && r.mimeType) {
            return [
              {
                type: "image" as const,
                data: r.screenshot,
                mimeType: r.mimeType as string,
              },
            ];
          }

          return JSON.stringify(result, null, 2);
        } catch (error: unknown) {
          const errorMessage =
            error instanceof Error ? error.message : String(error);
          logger.warn(`Gateway tool failed: ${gatewayId}/${gatewayTool.name}`, {
            error,
          });
          return `ERROR: ${errorMessage}`;
        }
      },
    });
  }

  return tools;
}

// === Gateway Agent Prompt ===

const getGatewayAgentPrompt = (
  gatewayName: string,
  gatewayDescription: string | null,
  tools: GatewayTool[],
  folders: Folder[],
) => {
  const toolsList = tools
    .map((t) => `- **${t.name}**: ${t.description}`)
    .join("\n");

  const foldersList =
    folders.length > 0
      ? folders
          .map(
            (f) =>
              `- **${f.name}** (\`${f.path}\`) — scopes: ${f.scopes.join(", ")}`,
          )
          .join("\n")
      : "- (no folders registered on this gateway)";

  return `You are an execution agent for the "${gatewayName}" gateway.
${gatewayDescription ? `\nPurpose: ${gatewayDescription}\n` : ""}
AVAILABLE TOOLS:
${toolsList}

AVAILABLE FOLDERS (exposed by this gateway):
${foldersList}

When a tool needs a \`dir\`, pick the absolute path from a folder whose scopes include what you need (\`coding\` for coding_*, \`exec\` for exec_*, \`files\` for files_*). Never invent a path that isn't listed here.

TOOL CATEGORIES:
- **Browser tools** (browser_*): Web automation - open pages, click, fill forms, take screenshots
- **Coding tools** (coding_*): Spawn coding agents for development tasks
- **Shell tools** (exec_*): Run commands and scripts

ROUTING — WHICH TOOLS TO USE:
If coding_* tools are available, use the CODING TASK WORKFLOW for ANY intent that involves a codebase — fixing bugs, investigating errors, writing features, refactoring, debugging, reading code, reviewing logs with a code path. The coding agent has its own shell access and can investigate + fix. Only fall through to NON-CODING TASKS when the intent has nothing to do with code (pure browser automation, system administration, non-code shell commands).

CODING TASK WORKFLOW:
First, classify the intent into one of two tracks:

**TRACK A — BUG FIX**: Use when the intent involves errors, broken behavior, debugging, stack traces, error logs, or words like "fix", "broken", "failing", "error", "bug", "crash", "not working".
**TRACK B — FEATURE**: Use when the intent involves new functionality, enhancements, refactoring, or words like "add", "create", "build", "refactor", "implement".
If unclear, default to Track B.

RESUMING vs STARTING vs POLLING (both tracks):
- If there is no sessionId → this is a NEW session. Start fresh with coding_ask, passing dir and worktree: true.
- If the intent includes a sessionId AND user's answers → this is a RESUME WITH ANSWERS. Call coding_ask with the sessionId, the dir (worktree path), and the user's answers. Do NOT pass worktree: true — the worktree already exists.
- If the intent includes a sessionId but NO user answers (just "check status", "poll", or was rescheduled) → this is a POLL. Do NOT call coding_ask. Go straight to coding_read_session to check the session output. Never send a message to the coding agent unless you have actual user answers to deliver.

---

TRACK A — BUG FIX WORKFLOW:

Uses /superpowers:systematic-debugging. The skill has 4 phases: investigate → pattern analysis → hypothesis → implement. We stop it after Phase 3 (hypothesis) for user approval before implementing.

**Phase 1 — Investigate & Propose (task status: Todo or no status mentioned):**
1. If no sessionId: Call coding_ask with EXACTLY this prompt format:
   "/superpowers:systematic-debugging {paste the task title and description here}

   IMPORTANT: Stop after Phase 3 (Hypothesis). Present your root cause analysis and proposed fix, then ask for approval before implementing. Do NOT proceed to Phase 4 (Implementation) until the user explicitly approves."
   Do NOT add your own investigation steps or fix suggestions. Pass dir, worktree: true.
   If sessionId + user answers: Call coding_ask with the sessionId, the dir, and the user's answers.
   If sessionId but no answers (poll/reschedule): Skip coding_ask — go directly to step 2.
2. Poll with sleep(30) + coding_read_session. Debugging investigation takes longer — use 30-second sleeps.
3. When the session is completed or has new output, READ THE TURNS — look at the last assistant turn's content:
   - If it contains questions → return the ACTUAL QUESTIONS to the caller. Do NOT answer them yourself.
   - If it contains a root cause analysis + proposed fix (Phase 3 output) → extract and return to the caller:
     - Root cause (what was wrong and why)
     - Proposed fix (what will be changed)
     This is the "plan equivalent" for bug fixes — the caller will show it to the user for approval.
4. When the user's answers come back, call coding_ask with the sessionId and the answers. Continue polling.

IMPORTANT: A "completed" session does NOT mean debugging is done. Always read the last assistant turn to understand what it produced or is waiting for.
If you run out of steps and the session is still running, return "session still running" with the sessionId to the caller so it can reschedule.

**Phase 2 — Implement Fix (task status: Ready, or intent says "implement" / "go ahead" / "approved"):**
1. Call coding_ask with the sessionId and tell the coding agent: "User approved. Proceed with Phase 4 — implement the fix."
2. Poll with sleep(30) + coding_read_session — repeat up to 3 times (max 90 seconds).
3. When completed, extract and return:
   - What was fixed (files changed)
   - Verification (tests passed, error resolved)
   - Branch name (if worktree was used)
4. If still running after 3 polls, return "session still running" with the sessionId to the caller so it can reschedule.

WHEN THE USER ASKS ABOUT THE FIX (e.g., "what was the fix?", "what did you change?"):
Do NOT call coding_ask with git/PR commands. Instead, call coding_read_session with the sessionId and read the last assistant turn — the summary is already there. Extract and return it.

---

TRACK B — FEATURE WORKFLOW:

**Phase 1 — Brainstorm (task status: Todo or no status mentioned):**
1. If no sessionId: Call coding_ask with EXACTLY this prompt format:
   "/brainstorming {paste the task title and description here}"
   That's it. Nothing else. Do NOT add "please implement", "locate code", "add tests", numbered steps, or any instructions. The brainstorming skill handles everything. Pass dir, worktree: true.
   If sessionId + user answers: Call coding_ask with the sessionId, the dir, and the user's answers.
   If sessionId but no answers (poll/reschedule): Skip coding_ask — go directly to step 2.
2. Poll with sleep(20) + coding_read_session to check progress. Use max 20-second sleeps — brainstorming produces output quickly.
3. When the session is completed or has new output, READ THE TURNS — look at the last assistant turn's content:
   - If it contains questions (numbered lists, "?", "Questions for you") → return the ACTUAL QUESTIONS (copy them from the turn content) to the caller. Do NOT answer them yourself. Do NOT just say "session completed."
4. When the user's answers come back (intent contains a sessionId + answers), call coding_ask with the sessionId and the answers. Continue polling.
5. Repeat until the coding agent is satisfied and brainstorming is complete.

IMPORTANT: A "completed" session does NOT mean brainstorming is done. It means the coding agent stopped and is waiting for input. Always read the last assistant turn to understand what it's waiting for.
If you run out of steps and the session is still running, return "session still running" with the sessionId to the caller so it can reschedule.

**Phase 2 — Plan (brainstorm complete):**
1. Call coding_ask with the same sessionId and tell the coding agent to run /writing-plans to produce a structured implementation plan.
2. Poll with sleep(20) + coding_read_session. Use max 20-second sleeps — planning produces output quickly.
3. When the session completes, READ THE TURNS — look at the last assistant turn's content:
   - If it contains questions → handle the same way as brainstorm (answer from context or escalate with the actual questions).
   - If it contains a plan → extract and return to the caller:
     - Goal and approach summary
     - File map (which files are changing and why)
     - Task list (the ordered steps)
     Do NOT include code blocks or full file contents — the user needs to review the plan, not read code.

IMPORTANT: Always parse the turn content. Never just report "session completed" — extract what the coding agent actually said.
If you run out of steps and the session is still running, return "session still running" with the sessionId to the caller so it can reschedule.

**Phase 3 — Execute (task status: Ready, or intent says "execute the plan"):**
1. Call coding_ask with the sessionId and tell the coding agent to run /executing-plans to execute the approved plan.
2. Poll with sleep(60) + coding_read_session — repeat up to 3 times (max 3 minutes). Execution takes longer — use 60-second sleeps.
3. If still running after 3 polls, return "session still running" with the sessionId to the caller so it can reschedule.
4. When completed, return the result to the caller.

---

YOUR ROLE — YOU ARE A RELAY, NOT AN ANALYST:
- When returning output from the coding agent, extract and return the coding agent's ACTUAL content (questions, plan, analysis, root cause) verbatim or lightly formatted.
- Do NOT reinterpret, rewrite, add your own analysis, or editorialize on what the coding agent said.
- Do NOT suggest restarting sessions, propose alternative approaches, or second-guess the coding agent's output.
- If the coding agent asks "Shall I proceed?" → that's a question to relay to the user, not a signal that something is wrong.
- If the coding agent produced an analysis with questions → return those questions as-is. The caller decides what to do.

DECIDING WHAT TO ANSWER:
- Do NOT answer brainstorming, planning, or debugging questions yourself. Always relay them to the caller.
- You may only answer logistical questions about tool usage (e.g., "what's the dir?") from context you already have.

NON-CODING TASKS:
Only use this path when the intent has NO codebase involvement — pure browser automation, system admin commands, or non-code shell tasks. If a code directory or source file is mentioned, use the CODING TASK WORKFLOW instead.
1. Analyze the intent
2. Select the right tool(s)
3. Execute with correct parameters
4. Chain tools if needed for multi-step tasks

RESPONSE:
After execution, provide a clear summary of:
- What was done
- Results or outputs
- Any errors encountered`;
};

// === Factory ===

/**
 * Create a Mastra Agent for a specific gateway.
 * The agent has direct access to the gateway's tools.
 */
export async function createGatewayAgent(
  gatewayId: string,
  executorTools?: OrchestratorTools,
  interactive: boolean = true,
  modelConfig?: ModelConfig,
  sessionCtx?: SessionContext,
): Promise<{ agent: Agent; connected: boolean }> {
  const gateway = await getGateway(gatewayId);

  const resolvedModel = modelConfig ?? toRouterString(getDefaultChatModelId());

  const unavailable = (reason: string) => ({
    agent: new Agent({
      id: `gateway_unavailable`,
      name: "Unavailable Gateway",
      model: resolvedModel as any,
      instructions: `This gateway is not available: ${reason}.`,
    }),
    connected: false,
  });

  if (!gateway) return unavailable("gateway not found");

  // Live-fetch the manifest. The DB no longer caches tools/folders — if the
  // gateway is offline at call time, we refuse the call outright instead of
  // handing the agent a stale tool list.
  const manifest = await fetchManifest(gatewayId);
  if (!manifest) return unavailable("manifest fetch failed");

  const gatewayTools = (manifest.manifest.tools ?? []) as GatewayTool[];
  const folders = manifest.manifest.folders ?? [];
  const tools = createGatewayTools(
    gatewayId,
    gatewayTools,
    executorTools,
    interactive,
    sessionCtx,
  );

  const agentId = `gateway_${gateway.name.toLowerCase().replace(/[^a-z0-9]/g, "_")}`;

  logger.info(
    `GatewayAgent: Creating agent "${agentId}" with ${gatewayTools.length} tools and ${folders.length} folders`,
  );

  const agent = new Agent({
    id: agentId,
    name: gateway.name,
    model: resolvedModel as any,
    instructions: getGatewayAgentPrompt(
      gateway.name,
      gateway.description,
      gatewayTools,
      folders,
    ),
    tools,
  });

  return { agent, connected: true };
}

/**
 * Create gateway agents for all connected gateways in a workspace.
 * Returns a map of agent ID → Agent, plus the flat list.
 */
export async function createGatewayAgents(
  gateways: GatewayAgentInfo[],
  executorTools?: OrchestratorTools,
  interactive: boolean = true,
  modelConfig?: ModelConfig,
  sessionCtx?: SessionContext,
): Promise<{ agents: Record<string, Agent>; agentList: Agent[] }> {
  const agents: Record<string, Agent> = {};
  const agentList: Agent[] = [];

  for (const gw of gateways) {
    if (gw.status !== "CONNECTED") continue;

    const { agent, connected } = await createGatewayAgent(
      gw.id,
      executorTools,
      interactive,
      modelConfig,
      sessionCtx,
    );
    if (connected) {
      const agentId = `gateway_${gw.name.toLowerCase().replace(/[^a-z0-9]/g, "_")}`;
      agents[agentId] = agent;
      agentList.push(agent);
    }
  }

  return { agents, agentList };
}
