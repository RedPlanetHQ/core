import { json, type LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { Contact } from "lucide-react";
import { PageHeader } from "~/components/common/page-header";
import { LogDetails } from "~/components/logs/log-details";
import { ResizablePanel, ResizablePanelGroup } from "~/components/ui/resizable";
import { TooltipProvider } from "~/components/ui/tooltip";
import {
  getIngestionQueueForFrontend,
  getPersonaForUser,
} from "~/services/ingestionLogs.server";
import { LabelService } from "~/services/label.server";
import { getUser } from "~/services/session.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const user = await getUser(request);

  const labelService = new LabelService();
  try {
    const logId = await getPersonaForUser(user?.Workspace?.id as string);
    const labels = await labelService.getWorkspaceLabels(
      user?.Workspace?.id as string,
    );

    if (!logId) {
      return json({ log: undefined, labels });
    }

    const log = await getIngestionQueueForFrontend(
      logId as string,
      user?.Workspace?.id as string,
    );

    return json({ log: log, labels });
  } catch (e) {
    return json({ log: null, labels: [] });
  }
}

export default function Persona() {
  const { log, labels } = useLoaderData<typeof loader>();

  if (!log) {
    return (
      <div className="flex h-full w-full flex-col">
        <PageHeader title="Episode" />
        <div className="flex h-[calc(100vh)] flex-col items-center justify-center gap-2 p-4 md:h-[calc(100vh_-_56px)]">
          <Contact size={30} />
          Persona is not generated, add a new episode to generate.
        </div>
      </div>
    );
  }

  return (
    <TooltipProvider delayDuration={0}>
      <div className="flex h-[calc(100vh)] w-full flex-col overflow-hidden md:h-[calc(100vh_-_16px)]">
        <PageHeader title="Persona" />

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
