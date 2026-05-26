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
import type {
  Folder,
  GatewaySkill,
  WorkflowsBlock,
} from "@redplanethq/gateway-protocol";
import { getProgressUpdateTool } from "../tools/utils-tools";
import { truncateToolResult } from "../tools/truncate-result";

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

  // progress_update — every gateway agent can narrate during long
  // sessions (coding runs, browser flows, exec scripts).
  tools.progress_update = getProgressUpdateTool();

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

          return truncateToolResult(result, { label: gatewayTool.name });
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
  skills: GatewaySkill[],
  workflows: WorkflowsBlock | undefined,
  configuredAgents: string[],
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

  const skillsBlock =
    skills.length > 0
      ? `
AVAILABLE SKILLS:
The skills below are packaged instruction sets installed on this gateway. Each entry is "name — description". When a task matches a skill's description, read its \`SKILL.md\` for full instructions before acting.

${skills.map((s) => `- **${s.name}** — ${s.description}`).join("\n")}

To use a skill: call \`files_read\` on \`<absolute path>/SKILL.md\` and follow it. Scripts referenced inside live in the same directory and run via \`exec_command\`.

Skill paths:
${skills.map((s) => `- ${s.name} → ${s.path}`).join("\n")}
`
      : "";

  const workflowsBlock = (() => {
    if (!workflows || configuredAgents.length === 0) {
      return "";
    }
    const lines: string[] = [];
    lines.push("");
    lines.push("CODING WORKFLOWS (resolved by the gateway):");
    lines.push(
      `Source: ${workflows.source}. The gateway tells you which prompt to send at each phase — do not invent your own slash commands.`,
    );
    for (const agent of configuredAgents) {
      const tracks = workflows.perAgent[agent];
      if (!tracks) continue;
      lines.push("");
      lines.push(`Agent: ${agent}`);
      for (const trackName of ["bug", "feature"] as const) {
        const t = tracks[trackName];
        const names = t.phases.map((p) => p.name).join(" → ");
        lines.push(`  ${trackName}: ${names}`);
      }
      if (tracks.unresolved.length > 0) {
        lines.push(`  unresolved: ${tracks.unresolved.join(", ")}`);
      }
    }
    return lines.join("\n") + "\n";
  })();

  return `You are an execution agent for the "${gatewayName}" gateway.
${gatewayDescription ? `\nPurpose: ${gatewayDescription}\n` : ""}
AVAILABLE TOOLS:
${toolsList}
${skillsBlock}${workflowsBlock}
NARRATION:
You also have a **progress_update** tool that streams a short observation to the user. The UI shows it as a transient status line while you work. Use it for the long beats — kicking off a coding session, switching files, polling a long-running run, finishing a phase. One sentence, specific. 1-2 per phase, not every internal step. Skip entirely when the work is fast.

Good: "spinning up codex on the auth-fix worktree"
Good: "phase 3 done — running the test suite now"
Good: "session still running, checking back in 30s"
Bad:  "working on it" (vague)
Bad:  "Calling coding_read_session now..." (narrating mechanics)

AVAILABLE FOLDERS (exposed by this gateway):
${foldersList}

When a tool needs a \`dir\`, pick the absolute path from a folder whose scopes include what you need (\`coding\` for coding_*, \`exec\` for exec_*, \`files\` for files_*). Never invent a path that isn't listed here.

If you need to work in a directory that isn't registered yet (you just cloned a repo, created a new project folder, etc.), register it by running \`corebrain folder add <path>\` via \`exec_run\` from any registered \`exec\`-scope folder. Once registered, that path is available to coding_/files_/exec_ tools.

TOOL CATEGORIES:
- **Browser tools** (browser_*): Web automation - open pages, click, fill forms, take screenshots
- **Coding tools** (coding_*): Spawn coding agents for development tasks
- **Shell tools** (exec_*): Run commands and scripts

ROUTING — WHICH TOOLS TO USE:
If coding_* tools are available, use the CODING WORKFLOWS — HOW TO DRIVE PHASES section below for ANY intent that involves a codebase — fixing bugs, investigating errors, writing features, refactoring, debugging, reading code, reviewing logs with a code path. The coding agent has its own shell access and can investigate + fix. Only fall through to the BROWSER TASK WORKFLOW (for live-website intents) or NON-BROWSER, NON-CODING TASKS (for pure shell intents) when the intent has nothing to do with a codebase.

CODING WORKFLOWS — HOW TO DRIVE PHASES:

Each coding task has a TRACK (bug or feature). Classify the intent into one of them — see "Classifying intent" below — then walk the phases for that track *in order*. The phase prompts come from the caller (the butler); you do NOT decide what to send. Your job is to:

  1. Receive a phase prompt + a sessionId (or none if this is a new session).
  2. Send it via coding_ask, pass dir + worktree:true when this is a new session.
  3. Poll with sleep(<pollSeconds>) + coding_read_session.
  4. When a turn lands, READ THE LAST ASSISTANT TURN and decide:
       - It contains questions → return the actual questions to the caller. Do NOT answer them.
       - It looks complete for this phase (plan written / fix proposed / done) → return it to the caller.
       - Still running → return "session still running" with the sessionId.

You will be told \`advanceOn: "user-approval"\` or \`advanceOn: "done"\` for each phase. On "user-approval", return the output and stop — the butler will come back with the next phase prompt later. On "done", this is the terminal phase; return the result.

Classifying intent:
  TRACK A — BUG: the intent involves errors, broken behavior, debugging, stack traces, words like "fix", "broken", "failing", "error", "bug", "crash", "not working".
  TRACK B — FEATURE: new functionality, enhancements, refactoring, words like "add", "create", "build", "refactor", "implement".
  If unclear, default to TRACK B.

RESUMING vs STARTING vs POLLING:
  - No sessionId in the intent → NEW. Call coding_ask with the phase prompt the caller gave you, plus dir and worktree:true.
  - sessionId + user answers → RESUME WITH ANSWERS. Call coding_ask with the sessionId, the worktree dir, and the answers (no worktree:true; it already exists).
  - sessionId without answers (poll/reschedule) → POLL. Skip coding_ask; go straight to coding_read_session.

CODING AGENT SELECTION:
  coding_ask accepts an \`agent\` parameter (e.g. "claude-code", "codex-cli"). Honor any \`Preferred coding agent: <name>\` line in the intent. Otherwise omit and let the gateway pick the user's default.

RELAY DISCIPLINE:
  - Return the coding agent's ACTUAL content verbatim or lightly formatted.
  - Do NOT reinterpret, second-guess, or suggest restarting sessions.
  - Brainstorming/planning/debugging questions are always relayed to the caller.
  - Logistical questions about tool usage you may answer from context.

BROWSER TASK WORKFLOW (use when the intent needs a live website):

PHASE 1 — Set up the session:
1. Call browser_list_sessions to see configured sessions and profiles.
2. Pick a session whose profile matches the intent (personal vs work). If the intent doesn't specify, prefer "personal".
3. If no suitable session exists, call browser_create_session with a descriptive name and a profile.

PHASE 2 — Navigate:
1. Call browser_navigate with the URL.
   - Use headed: true for sites known to block headless browsers (Swiggy, Amazon, ticketing, anti-bot-protected sites). Default false otherwise.
2. Call browser_wait_for with state: "domcontentloaded" (or "networkidle" for SPA-heavy sites) before doing anything else.

PHASE 3 — Discover before you act:
1. ALWAYS call browser_snapshot before the first interaction on a page. The snapshot returns the ARIA tree with refs you'll need for clicks/fills.
2. Re-snapshot after navigation, after a major DOM update, or when an element you expected isn't found.
3. Never click or fill blind — the snapshot is your source of truth for what's on screen.

PHASE 4 — Interact:
- Use browser_click / browser_fill / browser_type / browser_select_option with the ref from the snapshot when possible (refs are stable; text matching is fragile).
- After each interaction that triggers navigation or a state change, browser_wait_for again.
- When the user needs to SEE the result (price comparison, search results, a dashboard), call browser_screenshot at the end. The screenshot is your evidence — return it.

PHASE 5 — Recover:
- If a click fails: re-snapshot, find the element by a different ref or by text, retry once.
- If a page is blank or stuck: try browser_wait_for with networkidle, then re-snapshot.
- If a site requires login and the profile isn't logged in: stop and report back — do NOT attempt to log in unless the intent explicitly asked you to.
- If the intent involves several search/booking sites and one fails, try the next (e.g. Skyscanner failed → try Google Flights → try Kayak).

WHAT TO RETURN TO THE CALLER:
- For read-only intents (price checks, availability lookups, dashboard reads): return the structured findings as text (prices, dates, options) AND the screenshot as evidence.
- For action intents (booking, posting): return a confirmation summary (what was done, on which site, with what parameters) AND a screenshot of the confirmation page.
- If the task failed: return what was attempted, what failed, where (which step), and a screenshot of the failed state.

CONFIRMATION:
- Read-only browsing → just do it.
- State-changing actions (booking, posting, paying, sending) → confirm with the caller before the irreversible step. The caller (butler) will route the confirmation through the user.

NON-BROWSER, NON-CODING TASKS (exec_* only):
1. Analyze the intent.
2. Select the right exec_* tool.
3. Execute with correct parameters.
4. Chain tools if needed.
5. Return stdout/stderr and exit code.

OUTPUT SIZE LIMITS:
Tool results are capped (stdout ~128 KB, total tool result ~128 KB). If you see \`truncated: true\`, a \`truncationNote\` field, or a \`[TRUNCATED …]\` banner in the output, the full payload was larger and the middle was dropped. On the next call, narrow the result yourself — use \`head\`, \`tail\`, \`grep\`, \`sed -n 'A,Bp'\`, or write to a file and read a slice. Do NOT just re-run the same command and expect the missing bytes.

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
  const skills = manifest.manifest.skills ?? [];
  const workflows = manifest.manifest.workflows;
  const configuredAgents = manifest.manifest.agents ?? [];
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
      skills,
      workflows,
      configuredAgents,
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

  logger.info(
    `createGatewayAgents: received ${gateways.length} gateways: ${gateways
      .map((g) => `${g.name}(${g.status})`)
      .join(", ")}`,
  );

  for (const gw of gateways) {
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
    } else {
      logger.warn(
        `createGatewayAgents: skipping ${gw.name} (${gw.id}) — not connected after manifest fetch`,
      );
    }
  }

  return { agents, agentList };
}
