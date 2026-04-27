import {
  json,
  redirect,
  type LoaderFunctionArgs,
  type MetaFunction,
} from "@remix-run/node";
import {
  Outlet,
  useLoaderData,
  useLocation,
  useNavigate,
  useNavigation,
  useRevalidator,
} from "@remix-run/react";
import { useEffect, useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { PageHeader } from "~/components/common/page-header";
import { Button } from "~/components/ui/button";
import { EditGatewayDialog } from "~/components/gateway/edit-dialog";
import { DeleteGatewayDialog } from "~/components/gateway/delete-dialog";
import {
  BrowserActions,
  BrowserActionsProvider,
} from "~/components/browser/browser-actions-context";
import {
  GatewayProvider,
  GatewayShellProvider,
  useGateway,
  useGatewayShell,
  type GatewaySnapshot,
} from "~/components/gateway/gateway-provider";
import { requireUser } from "~/services/session.server";
import { getGateway } from "~/services/gateway.server";
import { refreshGatewayHealth } from "~/services/gateway/health.server";
import { getGatewayInfo } from "~/services/gateway/utils.server";
import { prisma } from "~/db.server";
import type { DeployMode } from "@redplanethq/gateway-protocol";

export const meta: MetaFunction<typeof loader> = ({ data }) => {
  const name = data?.gateway?.name;
  return [{ title: name ? `${name} | Gateways` : "Gateways" }];
};

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { workspaceId } = await requireUser(request);
  if (!workspaceId) throw new Error("Workspace not found");

  const { gatewayId } = params;
  if (!gatewayId) return redirect("/home/gateways");

  const gw = await prisma.gateway.findFirst({
    where: { id: gatewayId, workspaceId },
    select: {
      id: true,
      name: true,
      baseUrl: true,
      status: true,
      hostname: true,
      platform: true,
      lastSeenAt: true,
      lastHealthError: true,
    },
  });
  if (!gw) return redirect("/home/gateways");

  // Refresh health so status badge / connection indicator reflect reality.
  await refreshGatewayHealth(gatewayId).catch(() => "disconnected");

  // Live-fetch manifest for the initial provider snapshot — the client takes
  // over from here via /api/v1/gateways/:id/info on refresh.
  const info = await getGatewayInfo(gatewayId);

  // Re-read after refresh so status reflects the latest probe.
  const fresh = await getGateway(gatewayId);

  return json({
    gateway: {
      id: gw.id,
      name: fresh?.name ?? gw.name,
      baseUrl: fresh?.baseUrl ?? gw.baseUrl,
      status: (fresh?.status ?? gw.status) as "CONNECTED" | "DISCONNECTED",
      hostname: fresh?.hostname ?? gw.hostname ?? null,
      platform: fresh?.platform ?? gw.platform ?? null,
      lastSeenAt: fresh?.lastSeenAt ?? gw.lastSeenAt ?? null,
      lastHealthError: fresh?.lastHealthError ?? gw.lastHealthError ?? null,
    },
    info,
  });
}

export default function GatewayDetailLayout() {
  const { gateway, info } = useLoaderData<typeof loader>();
  const { revalidate } = useRevalidator();

  const snapshot: GatewaySnapshot = {
    id: gateway.id,
    name: info?.gateway.name?.trim() || gateway.name,
    description: info?.gateway.description?.trim() || null,
    baseUrl: gateway.baseUrl,
    status: gateway.status,
    deployMode: (info?.gateway.deployMode ?? "native") as DeployMode,
    hostname: gateway.hostname,
    platform: gateway.platform,
    folders: info?.folders ?? [],
    agents: info?.agents ?? [],
  };

  return (
    <BrowserActionsProvider>
      <GatewayProvider snapshot={snapshot} refresh={revalidate}>
        <GatewayShellProvider gatewayId={gateway.id}>
          <GatewayDetailShell />
        </GatewayShellProvider>
      </GatewayProvider>
    </BrowserActionsProvider>
  );
}

function GatewayDetailShell() {
  const navigate = useNavigate();
  const location = useLocation();
  const navigation = useNavigation();
  const gw = useGateway();
  const shell = useGatewayShell();
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const activePath = navigation.location?.pathname ?? location.pathname;
  const isTerminal = activePath.endsWith("/terminal");
  const isBrowser = /\/browser(\/|$)/.test(activePath);
  const isInfo = !isTerminal && !isBrowser;

  // Periodic re-run of the layout loader so the connection indicator,
  // manifest data, and DB-synced name/description stay current while the
  // page is open. The loader's `refreshGatewayHealth` already pulls the
  // manifest and writes name/description into the DB row, so we don't need
  // a separate manual refresh button.
  const refresh = gw.refresh;
  useEffect(() => {
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible") refresh();
    }, 20_000);
    return () => window.clearInterval(id);
  }, [refresh]);

  return (
    <div className="h-page-xs flex flex-col">
      <PageHeader
        title={gw.name}
        breadcrumbs={[
          { label: "Gateways", href: "/home/gateways" },
          { label: gw.name },
        ]}
        tabs={[
          {
            label: "Info",
            value: "info",
            isActive: isInfo,
            onClick: () => navigate(`/home/gateways/${gw.id}/info`),
          },
          {
            label: "Terminal",
            value: "terminal",
            isActive: isTerminal,
            onClick: () => navigate(`/home/gateways/${gw.id}/terminal`),
          },
          {
            label: "Browser",
            value: "browser",
            isActive: isBrowser,
            onClick: () => navigate(`/home/gateways/${gw.id}/browser`),
          },
        ]}
        actionsNode={
          isInfo ? (
            <div className="flex items-center gap-1.5">
              <Button
                variant="secondary"
                className="gap-1.5"
                onClick={() => setEditOpen(true)}
              >
                <Pencil size={12} />
                <span className="hidden md:inline">Edit</span>
              </Button>
              <Button
                variant="destructive"
                className="gap-1.5"
                onClick={() => setDeleteOpen(true)}
              >
                <Trash2 size={12} />
                <span className="hidden md:inline">Delete</span>
              </Button>
            </div>
          ) : isBrowser ? (
            <BrowserActions />
          ) : isTerminal ? (
            <Button
              variant="secondary"
              className="gap-1.5"
              onClick={() => shell.openShell(true)}
              disabled={shell.loading}
              title="Kill the current shell and start a fresh one"
            >
              <Plus size={12} />
              <span className="hidden md:inline">New shell</span>
            </Button>
          ) : null
        }
      />
      <div className="flex flex-1 overflow-hidden">
        <Outlet />
      </div>
      <EditGatewayDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        gatewayId={gw.id}
        currentBaseUrl={gw.baseUrl}
        onSaved={gw.refresh}
      />
      <DeleteGatewayDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        gatewayId={gw.id}
        gatewayName={gw.name}
        onDeleted={() => navigate("/home/gateways")}
      />
    </div>
  );
}

