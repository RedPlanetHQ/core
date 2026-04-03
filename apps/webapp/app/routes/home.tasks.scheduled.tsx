import { type LoaderFunctionArgs } from "@remix-run/node";
import { useNavigate } from "@remix-run/react";
import { getWorkspaceId, requireUser } from "~/services/session.server";
import { getTasks } from "~/services/task.server";
import { PageHeader } from "~/components/common/page-header";
import { ScheduledTaskList } from "~/components/tasks/scheduled-task-list";
import { typedjson, useTypedLoaderData } from "remix-typedjson";

// ─── Loader ───────────────────────────────────────────────────────────────────

export async function loader({ request }: LoaderFunctionArgs) {
  const user = await requireUser(request);
  const workspaceId = (await getWorkspaceId(
    request,
    user.id,
    user.workspaceId,
  )) as string;

  const tasks = await getTasks(workspaceId, { isScheduled: true });
  return typedjson({ tasks });
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ScheduledTasksPage() {
  const { tasks } = useTypedLoaderData<typeof loader>();
  const navigate = useNavigate();

  const handleSelect = (id: string) => {
    navigate(`/home/tasks/${id}`);
  };

  if (typeof window === "undefined") return null;

  return (
    <div className="flex h-[calc(100vh-16px)] flex-col">
      <PageHeader
        title="Tasks"
        tabs={[
          {
            label: "Tasks",
            value: "tasks",
            isActive: false,
            onClick: () => navigate("/home/tasks"),
          },
          {
            label: "Scheduled",
            value: "scheduled",
            isActive: true,
            onClick: () => navigate("/home/tasks/scheduled"),
          },
        ]}
      />

      <div className="flex flex-1 overflow-hidden">
        <div className="w-full overflow-hidden">
          <ScheduledTaskList
            tasks={tasks}
            selectedTaskId={null}
            onSelect={handleSelect}
            onNew={() => navigate("/home/tasks")}
          />
        </div>
      </div>
    </div>
  );
}
