import { json, type LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { Inbox } from "lucide-react";
import { PageHeader } from "~/components/common/page-header";
import { LogDetails } from "~/components/logs/log-details";
import { LogOptions } from "~/components/logs/log-options";
import { ResizablePanel, ResizablePanelGroup } from "~/components/ui/resizable";
import { TooltipProvider } from "~/components/ui/tooltip";
import { getIngestionQueueForFrontend } from "~/services/ingestionLogs.server";
import { requireUserId } from "~/services/session.server";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const userId = await requireUserId(request);
  const logId = params.episodeId;

  try {
    const log = await getIngestionQueueForFrontend(logId as string, userId);
    return json({ log: log });
  } catch (e) {
    return json({ log: null });
  }
}

export default function InboxNotSelected() {
  const { log } = useLoaderData<typeof loader>();

  if (!log) {
    return (
      <div className="flex h-full w-full flex-col">
        <PageHeader title="Episode" />
        <div className="flex h-full flex-col items-center justify-center gap-2">
          <Inbox size={30} />
          No episode data found
        </div>
      </div>
    );
  }

  return (
    <TooltipProvider delayDuration={0}>
      <div className="flex h-[calc(100vh_-_20px)] w-full flex-col overflow-hidden">
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
            <LogDetails log={log as any} />
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>
    </TooltipProvider>
  );
}
