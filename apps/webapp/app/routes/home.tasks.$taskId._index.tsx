import { useNavigate, useFetcher, useRouteLoaderData } from "@remix-run/react";
import { ClientOnly } from "remix-utils/client-only";
import { LoaderCircle } from "lucide-react";
import { useMemo } from "react";

import type { loader } from "~/routes/home.tasks.$taskId";
import { TaskDetailFull } from "~/components/tasks/task-detail-full.client";
import { WidgetContext } from "~/components/editor/extensions/widget-node-extension";

function TaskDetailInner() {
  const data = useRouteLoaderData<typeof loader>("routes/home.tasks.$taskId");
  const navigate = useNavigate();
  const fetcher = useFetcher();

  if (!data) return null;
  const {
    task,
    integrationAccountMap,
    butlerName,
    taskPageId,
    collabToken,
    widgetOptions,
    widgetPat,
    baseUrl,
    channels,
    defaultChannelName,
  } = data;

  const handleSave = (title: string) => {
    fetcher.submit(
      { intent: "update", title },
      { method: "POST", action: `/home/tasks/${task.id}` },
    );
  };

  const handleStatusChange = (status: string) => {
    fetcher.submit(
      { intent: "update-status", status },
      { method: "POST", action: `/home/tasks/${task.id}` },
    );
  };

  const handleCreateSubtask = (title: string, status: string) => {
    fetcher.submit(
      { intent: "create-subtask", title, status },
      { method: "POST", action: `/home/tasks/${task.id}` },
    );
  };

  const handleSubtaskStatusChange = (subtaskId: string, status: string) => {
    fetcher.submit(
      { intent: "update-subtask-status", subtaskId, status },
      { method: "POST", action: `/home/tasks/${task.id}` },
    );
  };

  const handleSubtaskDelete = (subtaskId: string) => {
    fetcher.submit(
      { intent: "delete-subtask", subtaskId },
      { method: "POST", action: `/home/tasks/${task.id}` },
    );
  };

  const handleChannelChange = (channelId: string | null) => {
    fetcher.submit(
      { intent: "update", channelId: channelId ?? "" },
      { method: "POST", action: `/home/tasks/${task.id}` },
    );
  };

  const widgetCtxValue = useMemo(
    () =>
      widgetPat && baseUrl
        ? { pat: widgetPat, baseUrl, widgetOptions: widgetOptions ?? [] }
        : null,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [widgetPat, baseUrl, JSON.stringify(widgetOptions)],
  );

  const detail = (
    <TaskDetailFull
      task={task}
      integrationAccountMap={integrationAccountMap}
      butlerName={butlerName}
      taskPageId={taskPageId}
      collabToken={collabToken}
      isSubmitting={fetcher.state !== "idle"}
      channels={channels}
      defaultChannelName={defaultChannelName}
      onSave={handleSave}
      onStatusChange={handleStatusChange}
      onCreateSubtask={handleCreateSubtask}
      onSubtaskStatusChange={handleSubtaskStatusChange}
      onSubtaskDelete={handleSubtaskDelete}
      onSubtaskClick={(id) => navigate(`/home/tasks/${id}`)}
      onChannelChange={handleChannelChange}
    />
  );

  if (widgetCtxValue) {
    return (
      <WidgetContext.Provider value={widgetCtxValue}>
        {detail}
      </WidgetContext.Provider>
    );
  }

  return detail;
}

export default function TaskDetailInfoPage() {
  if (typeof window === "undefined") return null;

  return (
    <ClientOnly
      fallback={
        <div className="flex h-full w-full items-center justify-center">
          <LoaderCircle className="h-4 w-4 animate-spin" />
        </div>
      }
    >
      {() => <TaskDetailInner />}
    </ClientOnly>
  );
}
