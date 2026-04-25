import { redirect, type LoaderFunctionArgs } from "@remix-run/node";
import { Outlet, useParams } from "@remix-run/react";
import { typedjson, useTypedLoaderData } from "remix-typedjson";
import { ClientOnly } from "remix-utils/client-only";
import { useEffect } from "react";
import { Globe } from "lucide-react";

import { getWorkspaceId, requireUser } from "~/services/session.server";
import {
  getBrowserSessionsForTask,
  type BrowserSessionListItem,
} from "~/services/browser/browser-session.server";
import { useSidebar } from "~/components/ui/sidebar";

export type BrowserOutletContext = {
  sessions: BrowserSessionListItem[];
  taskId: string;
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

  const sessions = await getBrowserSessionsForTask(taskId, workspaceId);
  return typedjson({ sessions });
}

function BrowserLayout() {
  const { sessions } = useTypedLoaderData<typeof loader>();
  const { taskId } = useParams<{ taskId: string }>();
  const { setOpen: setSidebarOpen } = useSidebar();

  // Browser viewer wants full width — collapse the workspace sidebar while
  // we're on this tab.
  useEffect(() => {
    setSidebarOpen(false);
    return () => setSidebarOpen(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (sessions.length === 0) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-2 px-8 text-center">
        <Globe className="h-8 w-8" />
        <p>No browser sessions for this task yet.</p>
        <p className="text-muted-foreground max-w-md text-sm">
          A session shows up here when the agent uses a browser tool on this
          task. The session stays linked until the task is marked Done.
        </p>
      </div>
    );
  }

  const ctx: BrowserOutletContext = {
    sessions,
    taskId: taskId!,
  };

  return (
    <div className="flex h-full w-full overflow-hidden">
      <Outlet context={ctx} />
    </div>
  );
}

export default function TaskBrowserLayout() {
  if (typeof window === "undefined") return null;
  return <ClientOnly fallback={null}>{() => <BrowserLayout />}</ClientOnly>;
}
