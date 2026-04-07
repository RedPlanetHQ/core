import { type LoaderFunctionArgs } from "@remix-run/server-runtime";
import { useLoaderData } from "@remix-run/react";
import { typedjson } from "remix-typedjson";
import { requireUser, requireWorkpace } from "~/services/session.server";
import { ClientOnly } from "remix-utils/client-only";
import { DailyPage } from "~/components/daily/daily-page.client";
import { PageHeader } from "~/components/common/page-header";
import { generateCollabToken } from "~/services/collab-token.server";
import { findOrCreateDailyPage } from "~/services/page.server";
import { getTasks } from "~/services/task.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const user = await requireUser(request);
  const workspace = await requireWorkpace(request);

  const [todayPage, blockedTasks] = await Promise.all([
    findOrCreateDailyPage(workspace?.id ?? "", user.id, new Date()),
    getTasks(workspace?.id ?? "", { status: "Blocked", isScheduled: false }),
  ]);

  return typedjson({
    butlerName: workspace?.name ?? "butler",
    workspaceId: workspace?.id ?? "",
    userId: user.id,
    collabToken: generateCollabToken(workspace?.id ?? "", user.id),
    todayPage: { id: todayPage.id, date: todayPage.date?.toISOString() ?? "" },
    blockedCount: blockedTasks.length,
  });
};

export default function DailyRoute() {
  const { butlerName, workspaceId, userId, collabToken, todayPage, blockedCount } =
    useLoaderData<typeof loader>() as any;

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <PageHeader title="Scratchpad" />
      <div className="flex h-[calc(100vh)] flex-col items-center overflow-y-auto p-2 px-3 md:h-[calc(100vh_-_56px)]">
        <ClientOnly
          fallback={
            <div className="text-muted-foreground p-6 text-sm">Loading…</div>
          }
        >
          {() => (
            <DailyPage
              butlerName={butlerName}
              workspaceId={workspaceId}
              userId={userId}
              collabToken={collabToken}
              blockedCount={blockedCount}
            />
          )}
        </ClientOnly>
      </div>
    </div>
  );
}
