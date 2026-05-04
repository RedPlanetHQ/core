import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/services/coding/coding-session.server", () => ({
  getLastCodingSession: vi.fn(),
  getCodingSessionsForTask: vi.fn(),
}));
vi.mock("~/services/browser/browser-session.server", () => ({
  getBrowserSessionsForTask: vi.fn(),
}));

import { getSessionTools } from "~/services/agent/tools/session-tools";
import {
  getLastCodingSession,
  getCodingSessionsForTask,
} from "~/services/coding/coding-session.server";
import { getBrowserSessionsForTask } from "~/services/browser/browser-session.server";

const mockedGetLast = vi.mocked(getLastCodingSession);
const mockedGetCodingList = vi.mocked(getCodingSessionsForTask);
const mockedGetBrowserList = vi.mocked(getBrowserSessionsForTask);

const WORKSPACE = "ws_1";
const TASK = "task_1";

// The tool() factory returns AI SDK tools whose execute signature is
// (input, context) — we don't pass context in unit tests.
type ExecutableTool = {
  execute: (input: Record<string, unknown>) => Promise<unknown>;
};

function getTool(
  tools: Record<string, unknown>,
  name: string,
): ExecutableTool {
  return tools[name] as ExecutableTool;
}

describe("session-tools", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("get_task_coding_session", () => {
    it("returns null when there is no session", async () => {
      mockedGetLast.mockResolvedValueOnce(null);

      const tools = getSessionTools({
        workspaceId: WORKSPACE,
        currentTaskId: TASK,
      });
      const result = await getTool(tools, "get_task_coding_session").execute(
        {},
      );

      expect(mockedGetLast).toHaveBeenCalledWith(TASK, WORKSPACE);
      expect(result).toEqual({ session: null });
    });

    it("returns ready when externalSessionId is set", async () => {
      mockedGetLast.mockResolvedValueOnce({
        externalSessionId: "sess_42",
        agent: "claude-code",
        dir: "/repo",
        worktreePath: "/wt/repo",
        worktreeBranch: "feature/x",
        gateway: { id: "gw_1", name: "gw" },
      } as Awaited<ReturnType<typeof getLastCodingSession>>);

      const tools = getSessionTools({
        workspaceId: WORKSPACE,
        currentTaskId: TASK,
      });
      const result = (await getTool(tools, "get_task_coding_session").execute(
        {},
      )) as { session: { status: string; sessionId: string } };

      expect(result.session.status).toBe("ready");
      expect(result.session.sessionId).toBe("sess_42");
    });

    it("returns starting when externalSessionId is null", async () => {
      mockedGetLast.mockResolvedValueOnce({
        externalSessionId: null,
        agent: "claude-code",
        dir: "/repo",
        worktreePath: null,
        worktreeBranch: null,
        gateway: { id: "gw_1", name: "gw" },
      } as Awaited<ReturnType<typeof getLastCodingSession>>);

      const tools = getSessionTools({
        workspaceId: WORKSPACE,
        currentTaskId: TASK,
      });
      const result = (await getTool(tools, "get_task_coding_session").execute(
        {},
      )) as { session: { status: string } };

      expect(result.session.status).toBe("starting");
    });

    it("uses an explicit taskId argument over currentTaskId", async () => {
      mockedGetLast.mockResolvedValueOnce(null);

      const tools = getSessionTools({
        workspaceId: WORKSPACE,
        currentTaskId: TASK,
      });
      await getTool(tools, "get_task_coding_session").execute({
        taskId: "task_other",
      });

      expect(mockedGetLast).toHaveBeenCalledWith("task_other", WORKSPACE);
    });

    it("errors when no taskId is available", async () => {
      const tools = getSessionTools({
        workspaceId: WORKSPACE,
        currentTaskId: undefined,
      });
      const result = (await getTool(tools, "get_task_coding_session").execute(
        {},
      )) as { error?: string };

      expect(result.error).toMatch(/no taskId/i);
      expect(mockedGetLast).not.toHaveBeenCalled();
    });
  });

  describe("list_task_coding_sessions", () => {
    it("returns mapped sessions", async () => {
      const now = new Date("2026-01-01T00:00:00Z");
      mockedGetCodingList.mockResolvedValueOnce([
        {
          id: "row_1",
          createdAt: now,
          updatedAt: now,
          agent: "claude-code",
          prompt: null,
          dir: "/repo",
          externalSessionId: "sess_a",
          conversationId: null,
          gatewayId: "gw_1",
          worktreePath: null,
          worktreeBranch: null,
          gateway: { id: "gw_1", name: "gw" },
        },
      ] as Awaited<ReturnType<typeof getCodingSessionsForTask>>);

      const tools = getSessionTools({
        workspaceId: WORKSPACE,
        currentTaskId: TASK,
      });
      const result = (await getTool(
        tools,
        "list_task_coding_sessions",
      ).execute({})) as {
        sessions: Array<{ sessionId: string | null; createdAt: string }>;
      };

      expect(result.sessions).toHaveLength(1);
      expect(result.sessions[0].sessionId).toBe("sess_a");
      expect(result.sessions[0].createdAt).toBe(now.toISOString());
    });
  });

  describe("list_task_browser_sessions", () => {
    it("returns mapped browser sessions", async () => {
      const now = new Date("2026-02-02T00:00:00Z");
      mockedGetBrowserList.mockResolvedValueOnce([
        {
          id: "row_b",
          createdAt: now,
          updatedAt: now,
          sessionName: "create_swiggy_order",
          profileName: "personal",
          taskId: TASK,
          gatewayId: "gw_1",
          gateway: { id: "gw_1", name: "gw" },
        },
      ] as Awaited<ReturnType<typeof getBrowserSessionsForTask>>);

      const tools = getSessionTools({
        workspaceId: WORKSPACE,
        currentTaskId: TASK,
      });
      const result = (await getTool(
        tools,
        "list_task_browser_sessions",
      ).execute({})) as {
        sessions: Array<{ sessionName: string; profileName: string }>;
      };

      expect(result.sessions).toEqual([
        expect.objectContaining({
          sessionName: "create_swiggy_order",
          profileName: "personal",
          gatewayId: "gw_1",
          gatewayName: "gw",
        }),
      ]);
    });
  });
});
