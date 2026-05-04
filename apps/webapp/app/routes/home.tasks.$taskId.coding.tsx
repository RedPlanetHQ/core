import { redirect } from "@remix-run/node";
import type { LoaderFunctionArgs } from "@remix-run/node";
import {
  Outlet,
  useNavigate,
  useParams,
  useRevalidator,
} from "@remix-run/react";
import { typedjson, useTypedLoaderData } from "remix-typedjson";
import { ClientOnly } from "remix-utils/client-only";
import { useCallback, useEffect, useState } from "react";
import { Terminal, Plus } from "lucide-react";

import { getWorkspaceId, requireUser } from "~/services/session.server";
import { getCodingSessionsForTask } from "~/services/coding/coding-session.server";
import type { CodingSessionListItem } from "~/services/coding/coding-session.server";
import { Button } from "~/components/ui/button";
import { useTauri } from "~/hooks/use-tauri";
import { NewSessionDialog } from "~/components/coding/new-session-dialog";
import { useSetCodingActions } from "~/components/coding/coding-actions-context";
import { useSidebar } from "~/components/ui/sidebar";
import { prisma } from "~/db.server";

export type CodingOutletContext = {
  sessions: CodingSessionListItem[];
  taskId: string;
  updateSessionExternalId: (sessionDbId: string, externalId: string) => void;
  openNewSession: () => void;
};

export async function loader({ request, params }: LoaderFunctionArgs) {
  const user = await requireUser(request);
  const workspaceId = (await getWorkspaceId(
    request,
    user.id,
    user.workspaceId,
  )) as string;

  const { taskId } = params;
  if (!taskId) return redirect("/home/tasks");

  const [sessions, task] = await Promise.all([
    getCodingSessionsForTask(taskId, workspaceId),
    prisma.task.findUnique({
      where: { id: taskId, workspaceId },
      select: { title: true, description: true },
    }),
  ]);

  return typedjson({
    sessions,
    taskTitle: task?.title ?? "",
    taskDescription: task?.description ?? null,
  });
}

function CodingLayout() {
  const {
    sessions: initialSessions,
    taskTitle,
    taskDescription,
  } = useTypedLoaderData<typeof loader>();
  const { taskId, sessionId } = useParams<{
    taskId: string;
    sessionId?: string;
  }>();
  const navigate = useNavigate();
  const { revalidate } = useRevalidator();
  const { isDesktop, invoke } = useTauri();
  const setCodingActions = useSetCodingActions();
  const { setOpen: setSidebarOpen } = useSidebar();
  const [corebrainError, setCorebrainError] = useState<string | null>(null);

  useEffect(() => {
    if (!isDesktop) return;
    invoke("check_corebrain_installed")
      .then(() => setCorebrainError(""))
      .catch((err: unknown) => setCorebrainError(String(err)));
  }, [isDesktop]); // eslint-disable-line react-hooks/exhaustive-deps

  const [sessions, setSessions] =
    useState<CodingSessionListItem[]>(initialSessions);
  const [newSessionOpen, setNewSessionOpen] = useState(false);

  // Keep local sessions state in sync when the loader revalidates (e.g. when
  // navigating back into this route after creating sessions elsewhere).
  useEffect(() => {
    setSessions(initialSessions);
  }, [initialSessions]);

  const updateSessionExternalId = useCallback(
    (sessionDbId: string, extId: string) => {
      setSessions((prev) =>
        prev.map((s) =>
          s.id === sessionDbId ? { ...s, externalSessionId: extId } : s,
        ),
      );
    },
    [],
  );

  const handleNewSessionCreated = (args: {
    id: string;
    agent: string;
    dir: string;
    gatewayId: string;
    externalSessionId: string | null;
    prompt: string | null;
  }) => {
    // Optimistic insert so the new session is in the popover immediately and
    // the session route doesn't bounce back (it looks up by id in this list).
    // Name is filled by the next loader revalidation; the popover treats the
    // empty string as "loading" rather than "gateway not available".
    const newSession: CodingSessionListItem = {
      id: args.id,
      agent: args.agent,
      dir: args.dir,
      createdAt: new Date(),
      updatedAt: new Date(),
      prompt: args.prompt,
      externalSessionId: args.externalSessionId,
      conversationId: null,
      gatewayId: args.gatewayId,
      worktreePath: null,
      worktreeBranch: null,
      gateway: { id: args.gatewayId, name: "" },
    };
    setSessions((prev) => [newSession, ...prev]);
    navigate(`/home/tasks/${taskId}/coding/${args.id}`);
    revalidate();
  };

  // Auto-collapse sidebar on mount, restore on unmount
  useEffect(() => {
    setSidebarOpen(false);
    return () => setSidebarOpen(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Register actions in the PageHeader
  useEffect(() => {
    setCodingActions({
      onNewSession: () => setNewSessionOpen(true),
      sessions: sessions.map((s) => ({
        id: s.id,
        agent: s.agent,
        createdAt: s.createdAt,
        prompt: s.prompt,
        gatewayName: s.gateway?.name ?? null,
      })),
      selectedId: sessionId ?? null,
      onSelectSession: (id) => navigate(`/home/tasks/${taskId}/coding/${id}`),
    });
    return () => setCodingActions(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessions, sessionId, taskId]);

  if (isDesktop && corebrainError) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-3 px-8">
        <Terminal className="text-muted-foreground h-8 w-8" />
        <p className="text-foreground text-sm font-medium">
          corebrain CLI not found
        </p>
        <p className="text-muted-foreground max-w-sm text-center text-sm">
          Install it to enable coding sessions:
        </p>
        <code className="bg-grayAlpha-50 rounded px-3 py-1.5 font-mono text-sm">
          npm install -g @redplanethq/corebrain
        </code>
        <Button
          variant="secondary"
          onClick={() =>
            invoke("check_corebrain_installed")
              .then(() => setCorebrainError(""))
              .catch((err: unknown) => setCorebrainError(String(err)))
          }
        >
          Check again
        </Button>
      </div>
    );
  }

  if (sessions.length === 0) {
    return (
      <>
        <div className="flex h-full w-full flex-col items-center justify-center gap-3">
          <Terminal className="text-muted-foreground h-8 w-8" />
          <p className="text-muted-foreground text-sm">
            No coding sessions yet
          </p>
          <Button variant="secondary" onClick={() => setNewSessionOpen(true)}>
            <Plus size={14} className="mr-1" />
            New session
          </Button>
        </div>
        <NewSessionDialog
          open={newSessionOpen}
          onOpenChange={setNewSessionOpen}
          taskId={taskId!}
          taskTitle={taskTitle}
          taskDescription={taskDescription}
          onCreated={handleNewSessionCreated}
        />
      </>
    );
  }

  const outletContext: CodingOutletContext = {
    sessions,
    taskId: taskId!,
    updateSessionExternalId,
    openNewSession: () => setNewSessionOpen(true),
  };

  return (
    <>
      <div className="h-full w-full overflow-hidden">
        <Outlet context={outletContext} />
      </div>

      <NewSessionDialog
        open={newSessionOpen}
        onOpenChange={setNewSessionOpen}
        taskId={taskId!}
        taskTitle={taskTitle}
        taskDescription={taskDescription}
        onCreated={handleNewSessionCreated}
      />
    </>
  );
}

export default function TaskCodingLayout() {
  if (typeof window === "undefined") return null;
  return <ClientOnly fallback={null}>{() => <CodingLayout />}</ClientOnly>;
}
