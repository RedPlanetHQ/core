import { json, type LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { Inbox } from "lucide-react";
import { PageHeader } from "~/components/common/page-header";
import { LogDetails } from "~/components/logs/log-details";
import { LogOptions } from "~/components/logs/log-options";
import { ResizablePanel, ResizablePanelGroup } from "~/components/ui/resizable";
import { TooltipProvider } from "~/components/ui/tooltip";
import { getIngestionQueueForFrontend } from "~/services/ingestionLogs.server";
import { LabelService } from "~/services/label.server";
import { getUser, requireUserId } from "~/services/session.server";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const user = await getUser(request);
  const logId = params.episodeId;
  const labelService = new LabelService();
  try {
    const log = await getIngestionQueueForFrontend(
      logId as string,
      user?.Workspace?.id as string,
    );
    const labels = await labelService.getWorkspaceLabels(
      user?.Workspace?.id as string,
    );
    return json({ log: log, labels });
  } catch (e) {
    return json({ log: null, labels: [] });
  }
}

export default function InboxNotSelected() {
  const { log, labels } = useLoaderData<typeof loader>();

  if (!log) {
    return (
      <div className="flex h-full w-full flex-col">
        <PageHeader title="Episode" />
        <div className="flex h-[calc(100vh_-_56px)] flex-col items-center justify-center gap-2 p-4">
          <Inbox size={30} />
          No episode data found
        </div>
      </div>
    );
  }

  return (
    <TooltipProvider delayDuration={0}>
      <div className="flex h-[calc(100vh_-_16px)] w-full flex-col overflow-hidden">
        <PageHeader
          title="Episode"
          actionsNode={<LogOptions id={log.id} status={log.status} />}
        />

        <ResizablePanelGroup direction="horizontal">
          <ResizablePanel
            maxSize={75}
            defaultSize={75}
            minSize={50}
            collapsible
            collapsedSize={50}
          >
            <LogDetails log={log as any} labels={labels} />
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>
    </TooltipProvider>
  );
}
