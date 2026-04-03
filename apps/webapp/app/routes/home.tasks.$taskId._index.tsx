import { useNavigate, useFetcher, useRouteLoaderData } from "@remix-run/react";
import { ClientOnly } from "remix-utils/client-only";
import { LoaderCircle } from "lucide-react";

import type { loader } from "~/routes/home.tasks.$taskId";
import { TaskDetailFull } from "~/components/tasks/task-detail-full.client";

export default function TaskDetailInfoPage() {
  const data = useRouteLoaderData<typeof loader>("routes/home.tasks.$taskId");
  const navigate = useNavigate();
  const fetcher = useFetcher();

  if (!data) return null;
  const { task, integrationAccountMap, butlerName, taskPageId, collabToken } =
    data;

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

  if (typeof window === "undefined") return null;

  return (
    <ClientOnly
      fallback={
        <div className="flex h-full w-full items-center justify-center">
          <LoaderCircle className="h-4 w-4 animate-spin" />
        </div>
      }
    >
      {() => (
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
      )}
    </ClientOnly>
  );
}
