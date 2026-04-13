import { type LoaderFunctionArgs } from "@remix-run/server-runtime";
import { useLoaderData } from "@remix-run/react";
import { typedjson } from "remix-typedjson";
import { requireUser, requireWorkpace } from "~/services/session.server";
import { ClientOnly } from "remix-utils/client-only";
import { DailyPage } from "~/components/daily/daily-page.client";
import { PageHeader } from "~/components/common/page-header";
import { generateCollabToken } from "~/services/collab-token.server";
import { findOrCreateDailyPage, todayUTCMidnightInTimezone } from "~/services/page.server";
import { getTasks } from "~/services/task.server";
import { getWidgetOptions, getOrCreateWidgetPat } from "~/services/widgets.server";
import { WidgetContext } from "~/components/editor/extensions/widget-node-extension";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const user = await requireUser(request);
  const workspace = await requireWorkpace(request);

  // Derive "today" in the user's local timezone so the prefetched page matches
  // what isToday() returns on the client. Using new Date() directly gives the
  // server's UTC date, which is wrong for users ahead of UTC (e.g. Asia/Kolkata)
  // in the first hours after their local midnight.
  const metadata = user.metadata as Record<string, unknown> | null;
  const timezone = (metadata?.timezone as string) || "UTC";
  const todayUTC = todayUTCMidnightInTimezone(timezone);

  const workspaceId = workspace?.id ?? "";

  const [todayPage, blockedTasks, widgetOptions, widgetPat] = await Promise.all([
    findOrCreateDailyPage(workspaceId, user.id, todayUTC),
    getTasks(workspaceId, { status: "Blocked", isScheduled: false }),
    getWidgetOptions(user.id, workspaceId),
    getOrCreateWidgetPat(workspaceId, user.id),
  ]);

  return typedjson({
    butlerName: workspace?.name ?? "butler",
    workspaceId,
    userId: user.id,
    collabToken: generateCollabToken(workspaceId, user.id),
    todayPage: { id: todayPage.id, date: todayPage.date?.toISOString() ?? "" },
    blockedCount: blockedTasks.length,
    widgetOptions,
    widgetPat,
    baseUrl: new URL(request.url).origin,
  });
};

export default function DailyRoute() {
  const { butlerName, workspaceId, userId, collabToken, todayPage, blockedCount, widgetOptions, widgetPat, baseUrl } =
    useLoaderData<typeof loader>() as any;

  const widgetCtxValue = widgetPat && baseUrl
    ? { pat: widgetPat, baseUrl, widgetOptions: widgetOptions ?? [] }
    : null;

  const page = (
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
              todayPage={todayPage}
              blockedCount={blockedCount}
            />
          )}
        </ClientOnly>
      </div>
    </div>
  );

  if (widgetCtxValue) {
    return (
      <WidgetContext.Provider value={widgetCtxValue}>
        {page}
      </WidgetContext.Provider>
    );
  }

  return page;
}
