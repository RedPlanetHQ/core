import { json, type LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { Inbox } from "lucide-react";
import { PageHeader } from "~/components/common/page-header";
import { LogDetails } from "~/components/logs/log-details";

import { getIngestionQueueForFrontend } from "~/services/ingestionLogs.server";
import { requireUserId } from "~/services/session.server";

export async function loader({ request, params }: LoaderFunctionArgs) {
  await requireUserId(request);
  const logId = params.logId;

  const log = await getIngestionQueueForFrontend(logId as string);

  return json({ log: log });
}

export default function InboxNotSelected() {
  const { log } = useLoaderData<typeof loader>();

  if (!log) {
    return (
      <div className="flex h-full w-full flex-col">
        <PageHeader title="Episode" showTrigger={false} />
        <div className="flex h-full flex-col items-center justify-center gap-2">
          <Inbox size={30} />
          No episode data found
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full w-full flex-col">
      <PageHeader title="Episode" showTrigger={false} />

      <LogDetails log={log as any} />
    </div>
  );
}
