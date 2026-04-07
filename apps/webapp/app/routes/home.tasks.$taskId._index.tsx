import { useNavigate, useFetcher, useRouteLoaderData } from "@remix-run/react";
import { ClientOnly } from "remix-utils/client-only";
import { LoaderCircle } from "lucide-react";
import { useEffect, useRef } from "react";

import type { loader } from "~/routes/home.tasks.$taskId";
import { TaskDetailFull } from "~/components/tasks/task-detail-full.client";
import { useChatPanel } from "~/components/chat-panel/chat-panel-context";

function TaskDetailInner() {
  const data = useRouteLoaderData<typeof loader>("routes/home.tasks.$taskId");
  const navigate = useNavigate();
  const fetcher = useFetcher();
  const { openChatWithConversation, setCurrentTaskId } = useChatPanel()!;
  const openedRunRef = useRef<string | null>(null);

  if (!data) return null;
  const { task, integrationAccountMap, butlerName, taskPageId, collabToken, runs } = data;

  const latestRun = runs?.[0] ?? null;

  // Set current task ID so the history popover filters to this task's runs
  // eslint-disable-next-line react-hooks/rules-of-hooks
  useEffect(() => {
    setCurrentTaskId(task.id);
    return () => setCurrentTaskId(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task.id]);

  // Open the latest run's conversation in the chat panel on mount
  // eslint-disable-next-line react-hooks/rules-of-hooks
  useEffect(() => {
    if (latestRun?.id && openedRunRef.current !== latestRun.id) {
      openedRunRef.current = latestRun.id;
      openChatWithConversation(latestRun.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [latestRun?.id]);

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

  return (
    <TaskDetailFull
      task={task}
      integrationAccountMap={integrationAccountMap}
      butlerName={butlerName}
      taskPageId={taskPageId}
      collabToken={collabToken}
      isSubmitting={fetcher.state !== "idle"}
      onSave={handleSave}
      onStatusChange={handleStatusChange}
      onCreateSubtask={handleCreateSubtask}
      onSubtaskStatusChange={handleSubtaskStatusChange}
      onSubtaskDelete={handleSubtaskDelete}
      onSubtaskClick={(id) => navigate(`/home/tasks/${id}`)}
    />
  );
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
