import { json, redirect } from "@remix-run/node";
import type {
  ActionFunctionArgs,
  LoaderFunctionArgs,
} from "@remix-run/server-runtime";
import { useRef } from "react";
import { useFetcher } from "@remix-run/react";
import { typedjson, useTypedLoaderData } from "remix-typedjson";
import { ClientOnly } from "remix-utils/client-only";
import { LoaderCircle, Plus } from "lucide-react";

import { requireUser, requireWorkpace } from "~/services/session.server";
import { getOrCreatePersonalAccessToken } from "~/services/personalAccessToken.server";
import { prisma } from "~/db.server";
import { PageHeader } from "~/components/common/page-header";
import { OverviewGrid, type OverviewGridHandle } from "~/components/overview/overview-grid.client";
import type { OverviewCell, WidgetOption } from "~/components/overview/types";

interface WidgetMeta {
  name: string;
  slug: string;
  description: string;
  support: Array<"tui" | "webapp">;
}

export async function loader({ request }: LoaderFunctionArgs) {
  const user = await requireUser(request);
  const workspace = await requireWorkpace(request);

  const empty = {
    cells: [] as OverviewCell[],
    widgetOptions: [] as WidgetOption[],
    widgetPat: null as string | null,
    baseUrl: new URL(request.url).origin,
  };

  if (!workspace) return typedjson(empty);

  const meta = (workspace.metadata ?? {}) as Record<string, unknown>;
  if (!meta.widgetsEnabled) throw redirect("/home/conversation");

  // All connected accounts that belong to an integration with a frontendUrl.
  const accounts = await prisma.integrationAccount.findMany({
    where: {
      integratedById: user.id,
      workspaceId: workspace.id,
      isActive: true,
      integrationDefinition: { frontendUrl: { not: null } },
    },
    select: {
      id: true,
      integrationDefinition: {
        select: {
          name: true,
          slug: true,
          icon: true,
          frontendUrl: true,
          spec: true,
        },
      },
    },
  });

  // Flatten into individual widget options (webapp-supported only).
  const widgetOptions: WidgetOption[] = [];
  for (const account of accounts) {
    const def = account.integrationDefinition;
    const spec = def.spec as { widgets?: WidgetMeta[] } | null;
    const widgets = spec?.widgets ?? [];
    for (const w of widgets) {
      if (!w.support.includes("webapp")) continue;
      widgetOptions.push({
        widgetSlug: w.slug,
        widgetName: w.name,
        widgetDescription: w.description,
        integrationSlug: def.slug,
        integrationName: def.name,
        integrationIcon: def.icon ?? null,
        frontendUrl: def.frontendUrl!,
        integrationAccountId: account.id,
      });
    }
  }

  const cells = (meta.overviewLayout ?? []) as OverviewCell[];

  // Ensure a widget PAT exists; store the plain token once in workspace.widgetPat.
  let widgetPat = workspace.widgetPat ?? null;
  if (!widgetPat) {
    const result = await getOrCreatePersonalAccessToken({
      name: "widget",
      userId: user.id,
      workspaceId: workspace.id,
      returnDecrypted: true,
    });
    widgetPat = result.token ?? null;
    if (widgetPat) {
      await prisma.workspace.update({
        where: { id: workspace.id },
        data: { widgetPat },
      });
    }
  }

  return typedjson({
    cells,
    widgetOptions,
    widgetPat,
    baseUrl: new URL(request.url).origin,
  });
}

export async function action({ request }: ActionFunctionArgs) {
  const workspace = await requireWorkpace(request);
  if (!workspace) return json({ error: "No workspace" }, { status: 400 });

  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "save-layout" && (formData.get("cells") as string)) {
    const cells = JSON.parse(formData.get("cells") as string) as OverviewCell[];
    const existing = await prisma.workspace.findFirst({
      where: { id: workspace.id },
      select: { metadata: true },
    });
    const existingMeta = (existing?.metadata ?? {}) as Record<string, unknown>;
    await prisma.workspace.update({
      where: { id: workspace.id },
      data: { metadata: { ...existingMeta, overviewLayout: cells } },
    });
    return json({ ok: true });
  }

  return json({ error: "Unknown intent" }, { status: 400 });
}

export default function Overview() {
  const { cells, widgetOptions, widgetPat, baseUrl } =
    useTypedLoaderData<typeof loader>();
  const fetcher = useFetcher();
  const gridRef = useRef<OverviewGridHandle>(null);

  const handleSave = (updatedCells: OverviewCell[]) => {
    fetcher.submit(
      { intent: "save-layout", cells: JSON.stringify(updatedCells) },
      { method: "POST" },
    );
  };

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="Overview"
        actions={[
          {
            label: "Add widget",
            icon: <Plus size={14} />,
            onClick: () => gridRef.current?.addCell(),
          },
        ]}
      />
      <div className="flex h-[calc(100vh_-_56px)] w-full flex-col overflow-auto">
        <ClientOnly
          fallback={
            <div className="flex h-full items-center justify-center">
              <LoaderCircle className="h-5 w-5 animate-spin" />
            </div>
          }
        >
          {() => (
            <OverviewGrid
              ref={gridRef}
              initialCells={cells}
              widgetOptions={widgetOptions}
              onSave={handleSave}
              widgetPat={widgetPat}
              baseUrl={baseUrl}
            />
          )}
        </ClientOnly>
      </div>
    </div>
  );
}
