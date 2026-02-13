import { json, type LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { Inbox } from "lucide-react";
import { PageHeader } from "~/components/common/page-header";
import { LogDetails } from "~/components/logs/log-details";
import { LogOptions } from "~/components/logs/log-options";
import { ResizablePanel, ResizablePanelGroup } from "~/components/ui/resizable";
import { TooltipProvider } from "~/components/ui/tooltip";
import { getDocument } from "~/services/document.server";

import { LabelService } from "~/services/label.server";
import { getUser, getWorkspaceId } from "~/services/session.server";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const user = await getUser(request);
  const workspaceId = await getWorkspaceId(request, user?.id as string);

  const documentId = params.episodeId;
  const labelService = new LabelService();
  try {
    const document = await getDocument(
      documentId as string,
      workspaceId as string,
    );
    const labels = await labelService.getWorkspaceLabels(
      workspaceId as string,
    );
    return json({ document, labels });
  } catch (e) {
    return json({ document: null, labels: [] });
  }
}

export default function InboxNotSelected() {
  const { document, labels } = useLoaderData<typeof loader>();

  if (!document) {
    return (
      <div className="flex h-full w-full flex-col">
        <PageHeader title="Document" />
        <div className="flex h-[calc(100vh)] flex-col items-center justify-center gap-2 p-4 md:h-[calc(100vh_-_56px)]">
          <Inbox size={30} />
          No document data found
        </div>
      </div>
    );
  }

  return (
    <TooltipProvider delayDuration={0}>
      <div className="flex h-[calc(100vh)] w-full flex-col overflow-hidden md:h-[calc(100vh_-_16px)]">
        <PageHeader
          title="Document"
          actionsNode={
            <LogOptions
              id={document.id as string}
              status={document.latestIngestionLog?.status}
            />
          }
        />

        <ResizablePanelGroup orientation="horizontal">
          <ResizablePanel
            maxSize={75}
            defaultSize={75}
            minSize={50}
            collapsible
            collapsedSize={50}
          >
            <LogDetails document={document as any} labels={labels} />
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>
    </TooltipProvider>
  );
}
