import type { LoaderFunctionArgs } from "@remix-run/server-runtime";
import { useMemo } from "react";
import { useLoaderData, type MetaFunction } from "@remix-run/react";
import { typedjson } from "remix-typedjson";
import { requireUser, requireWorkpace } from "~/services/session.server";
import { ClientOnly } from "remix-utils/client-only";
import { DailyPage } from "~/components/daily/daily-page.client";
import { PageHeader } from "~/components/common/page-header";
import { generateCollabToken } from "~/services/collab-token.server";
import {
  findOrCreateDailyPage,
  todayUTCMidnightInTimezone,
} from "~/services/page.server";
import {
  getWidgetOptions,
  getOrCreateWidgetPat,
} from "~/services/widgets.server";
import { WidgetContext } from "~/components/editor/extensions/widget-node-extension";

export const meta: MetaFunction = () => [{ title: "Daily" }];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const user = await requireUser(request);
  const workspace = await requireWorkpace(request);

  const metadata = user.metadata as Record<string, unknown> | null;
  const timezone = (metadata?.timezone as string) || "UTC";
  const todayUTC = todayUTCMidnightInTimezone(timezone);

  const workspaceId = workspace?.id ?? "";

  const [todayPage, widgetOptions, widgetPat] = await Promise.all([
    findOrCreateDailyPage(workspaceId, user.id, todayUTC),
    getWidgetOptions(user.id, workspaceId),
    getOrCreateWidgetPat(workspaceId, user.id),
  ]);

  return typedjson({
    butlerName: workspace?.name ?? "butler",
    workspaceId,
    userId: user.id,
    collabToken: generateCollabToken(workspaceId, user.id),
    todayPage: { id: todayPage.id, date: todayPage.date?.toISOString() ?? "" },
    widgetOptions,
    widgetPat,
    baseUrl: new URL(request.url).origin,
  });
};

export default function DailyRoute() {
  const {
    butlerName,
    workspaceId,
    userId,
    collabToken,
    todayPage,
    widgetOptions,
    widgetPat,
    baseUrl,
  } = useLoaderData<typeof loader>() as any;

  const widgetCtxValue = useMemo(
    () =>
      widgetPat && baseUrl
        ? { pat: widgetPat, baseUrl, widgetOptions: widgetOptions ?? [] }
        : null,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [widgetPat, baseUrl, JSON.stringify(widgetOptions)],
  );

  const page = (
    <div className="flex h-full flex-col overflow-hidden">
      <PageHeader title="Scratchpad" />

      <div className="flex h-full flex-1 flex-col items-center overflow-y-auto p-2 pl-3 pr-0">
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
