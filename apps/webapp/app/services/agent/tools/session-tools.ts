/**
 * Session lookup tools.
 *
 * Replace the previous prompt-injection of `lastCodingSession` (sessionId, dir,
 * branch, agent) with on-demand tool calls. The CodingSession / BrowserSession
 * tables map workspace-side `taskId` → gateway-side session identifiers; the
 * gateway itself has no notion of tasks, so this lookup must live in the
 * webapp.
 *
 * The agent calls these only when it actually needs to resume or report on a
 * task's session — most prompts no longer carry that data unconditionally.
 */

import { tool, type Tool } from "ai";
import { z } from "zod";

import {
  getLastCodingSession,
  getCodingSessionsForTask,
} from "~/services/coding/coding-session.server";
import { getBrowserSessionsForTask } from "~/services/browser/browser-session.server";
import { resolveTaskId } from "~/services/task.server";

interface GetSessionToolsParams {
  workspaceId: string;
  /** Defaults the optional `taskId` arg when the agent omits it. */
  currentTaskId?: string;
}

export function getSessionTools(
  params: GetSessionToolsParams,
): Record<string, Tool> {
  const { workspaceId, currentTaskId } = params;

  // Agent passes displayId (tk-…); currentTaskId is a server-injected UUID.
  // Either is acceptable; resolveTaskId handles both shapes and scopes the
  // lookup to this workspace.
  const resolve = async (
    argTaskId: string | undefined,
  ): Promise<string | { error: string }> => {
    const input = argTaskId ?? currentTaskId;
    if (!input) {
      return {
        error:
          "No taskId provided and no current task in context — pass taskId explicitly.",
      };
    }
    const uuid = await resolveTaskId(input, workspaceId);
    if (!uuid) return { error: `Task "${input}" not found in this workspace.` };
    return uuid;
  };

  return {
    get_task_coding_session: tool({
      description:
        "Get the most recent coding session recorded for a task. Returns the gateway-side sessionId, agent name, working directory, worktree path and branch (when applicable), and gateway info. Call before delegating coding work to the gateway so you can resume an existing session instead of starting a new one. Returns null when the task has no coding session yet.",
      inputSchema: z.object({
        taskId: z
          .string()
          .optional()
          .describe(
            "Task displayId to look up (e.g. tk-abcde). Defaults to the current task in context when omitted.",
          ),
      }),
      execute: async ({ taskId }) => {
        const resolved = await resolve(taskId);
        if (typeof resolved !== "string") return resolved;

        const session = await getLastCodingSession(resolved, workspaceId);
        if (!session) return { session: null };

        return {
          session: {
            sessionId: session.externalSessionId,
            agent: session.agent,
            dir: session.dir,
            worktreePath: session.worktreePath,
            worktreeBranch: session.worktreeBranch,
            gatewayId: session.gateway?.id ?? null,
            gatewayName: session.gateway?.name ?? null,
            // The CodingSession row exists but the gateway hasn't echoed back
            // an externalSessionId yet — agent should wait, not start a new run.
            status: session.externalSessionId ? "ready" : "starting",
          },
        };
      },
    }),

    list_task_coding_sessions: tool({
      description:
        "List ALL coding sessions for a task in newest-first order. Use when you need history (multiple sessions across worktrees) rather than just the latest. Returns an empty array when none exist.",
      inputSchema: z.object({
        taskId: z
          .string()
          .optional()
          .describe(
            "Task displayId to look up (e.g. tk-abcde). Defaults to the current task in context when omitted.",
          ),
      }),
      execute: async ({ taskId }) => {
        const resolved = await resolve(taskId);
        if (typeof resolved !== "string") return resolved;

        const sessions = await getCodingSessionsForTask(resolved, workspaceId);
        return {
          sessions: sessions.map((s) => ({
            id: s.id,
            sessionId: s.externalSessionId,
            agent: s.agent,
            dir: s.dir,
            worktreePath: s.worktreePath,
            worktreeBranch: s.worktreeBranch,
            gatewayId: s.gatewayId,
            gatewayName: s.gateway?.name ?? null,
            createdAt: s.createdAt.toISOString(),
            updatedAt: s.updatedAt.toISOString(),
          })),
        };
      },
    }),

    list_task_browser_sessions: tool({
      description:
        "List browser sessions a task has claimed on its gateways. Returns the session names and profile bindings — pass a returned `sessionName` to subsequent browser_* tool calls. Empty when the task has not opened any browser sessions yet.",
      inputSchema: z.object({
        taskId: z
          .string()
          .optional()
          .describe(
            "Task displayId to look up (e.g. tk-abcde). Defaults to the current task in context when omitted.",
          ),
      }),
      execute: async ({ taskId }) => {
        const resolved = await resolve(taskId);
        if (typeof resolved !== "string") return resolved;

        const sessions = await getBrowserSessionsForTask(
          resolved,
          workspaceId,
        );
        return {
          sessions: sessions.map((s) => ({
            id: s.id,
            sessionName: s.sessionName,
            profileName: s.profileName,
            gatewayId: s.gatewayId,
            gatewayName: s.gateway?.name ?? null,
            createdAt: s.createdAt.toISOString(),
            updatedAt: s.updatedAt.toISOString(),
          })),
        };
      },
    }),
  };
}
