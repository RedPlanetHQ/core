import { json } from "@remix-run/node";
import type {
  ActionFunctionArgs,
  LoaderFunctionArgs,
} from "@remix-run/server-runtime";
import { useCallback, useMemo } from "react";
import { useLoaderData, useFetcher, type MetaFunction } from "@remix-run/react";
import { typedjson } from "remix-typedjson";
import { requireUser, requireWorkpace } from "~/services/session.server";
import { ClientOnly } from "remix-utils/client-only";
import { DailyPage } from "~/components/daily/daily-page.client";
import { DailyWidgetPanel } from "~/components/daily/daily-widget-panel.client";
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
import { useLocalCommonState } from "~/hooks/use-local-state";
import { prisma } from "~/db.server";
import type { OverviewCell } from "~/components/overview/types";
import { LayoutGrid } from "lucide-react";
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from "~/components/ui/resizable";

const STORAGE_SIZE_KEY = "daily-widget-panel-size";

export const meta: MetaFunction = () => [{ title: "Daily" }];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const user = await requireUser(request);
  const workspace = await requireWorkpace(request);

  const metadata = user.metadata as Record<string, unknown> | null;
  const timezone = (metadata?.timezone as string) || "UTC";
  const todayUTC = todayUTCMidnightInTimezone(timezone);

  const workspaceId = workspace?.id ?? "";

  const workspaceMeta = (workspace?.metadata ?? {}) as Record<string, unknown>;
  const dailyWidgetCells = (workspaceMeta.dailyWidgetLayout ??
    []) as OverviewCell[];

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
    dailyWidgetCells,
  });
};

export async function action({ request }: ActionFunctionArgs) {
  const workspace = await requireWorkpace(request);
  if (!workspace) return json({ error: "No workspace" }, { status: 400 });

  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "save-daily-widgets") {
    const cells = JSON.parse(formData.get("cells") as string) as OverviewCell[];
    const existing = await prisma.workspace.findFirst({
      where: { id: workspace.id },
      select: { metadata: true },
    });
    const existingMeta = (existing?.metadata ?? {}) as Record<string, unknown>;
    await prisma.workspace.update({
      where: { id: workspace.id },
      data: { metadata: { ...existingMeta, dailyWidgetLayout: cells } },
    });
    return json({ ok: true });
  }

  return json({ error: "Unknown intent" }, { status: 400 });
}

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
    dailyWidgetCells,
  } = useLoaderData<typeof loader>() as any;

  const fetcher = useFetcher();

  const [panelOpen, setPanelOpen] = useLocalCommonState<boolean>(
    "daily-widget-panel-open",
    false,
  );

  const openWidgetPanel = useCallback(() => {
    setPanelOpen(true);
  }, [setPanelOpen]);

  const handleSaveWidgets = (cells: OverviewCell[]) => {
    fetcher.submit(
      { intent: "save-daily-widgets", cells: JSON.stringify(cells) },
      { method: "POST" },
    );
  };

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
      <PageHeader
        title="Scratchpad"
        actions={[
          {
            label: "Widgets",
            icon: <LayoutGrid size={14} />,
            onClick: panelOpen ? () => setPanelOpen(false) : openWidgetPanel,
            variant: panelOpen ? "secondary" : "ghost",
          },
        ]}
      />

      <ResizablePanelGroup
        orientation="horizontal"
        className="flex-1 overflow-hidden"
      >
        {/* Main daily content */}
        <ResizablePanel minSize="40%">
          <div className="flex h-full flex-col items-center overflow-y-auto p-2 pl-3 pr-0">
            <ClientOnly
              fallback={
                <div className="text-muted-foreground p-6 text-sm">
                  Loading…
                </div>
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
        </ResizablePanel>

        {panelOpen && <ResizableHandle withHandle />}

        {panelOpen && (
          <ResizablePanel
            defaultSize={`${Number(localStorage.getItem(STORAGE_SIZE_KEY)) || 35}%`}
            minSize="25%"
            collapsible
            collapsedSize={0}
            onCollapse={() => setPanelOpen(false)}
            onResize={(size) => {
              localStorage.setItem(STORAGE_SIZE_KEY, String(size));
            }}
          >
            <ClientOnly fallback={null}>
              {() => (
                <DailyWidgetPanel
                  initialCells={dailyWidgetCells}
                  widgetOptions={widgetOptions ?? []}
                  onSave={handleSaveWidgets}
                  widgetPat={widgetPat}
                  baseUrl={baseUrl}
                />
              )}
            </ClientOnly>
          </ResizablePanel>
        )}
      </ResizablePanelGroup>
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
