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
import { Pencil, Trash2 } from "lucide-react";
import { PageHeader } from "~/components/common/page-header";
import { Button } from "~/components/ui/button";
import { EditGatewayDialog } from "~/components/gateway/edit-dialog";
import { DeleteGatewayDialog } from "~/components/gateway/delete-dialog";
import {
  BrowserActions,
  BrowserActionsProvider,
} from "~/components/browser/browser-actions-context";
import { requireUser } from "~/services/session.server";
import { getGateway } from "~/services/gateway.server";
import { refreshGatewayHealth } from "~/services/gateway/health.server";
import { getGatewayInfo } from "~/services/gateway/utils.server";
import { prisma } from "~/db.server";
import type {
  AvailableAgent,
  DeployMode,
  Folder,
} from "@redplanethq/gateway-protocol";

export interface GatewayOutletContext {
  gatewayId: string;
  gatewayName: string;
  baseUrl: string;
  status: "CONNECTED" | "DISCONNECTED";
  deployMode: DeployMode;
  hostname: string | null;
  platform: string | null;
  folders: Folder[];
  agents: string[];
  availableAgents: AvailableAgent[];
  refresh: () => void;
}

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

  // Live-fetch manifest for folders / agents / deploy mode. If the gateway
  // is unreachable we surface what we know from the DB and let the UI show
  // an empty state.
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
  const navigate = useNavigate();
  const location = useLocation();
  const navigation = useNavigation();
  const { revalidate } = useRevalidator();
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const activePath = navigation.location?.pathname ?? location.pathname;
  const isTerminal = activePath.endsWith("/terminal");
  const isBrowser = /\/browser(\/|$)/.test(activePath);
  const isInfo = !isTerminal && !isBrowser;

  // Periodically refresh status while the page is open so the connection
  // indicator and "last seen" are honest.
  useEffect(() => {
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible") revalidate();
    }, 20_000);
    return () => window.clearInterval(id);
  }, [revalidate]);

  const deployMode: DeployMode = info?.gateway.deployMode ?? "native";

  const ctx: GatewayOutletContext = {
    gatewayId: gateway.id,
    gatewayName: gateway.name,
    baseUrl: gateway.baseUrl,
    status: gateway.status,
    deployMode,
    hostname: gateway.hostname,
    platform: gateway.platform,
    folders: info?.folders ?? [],
    agents: info?.agents ?? [],
    availableAgents: info?.availableAgents ?? [],
    refresh: () => revalidate(),
  };

  return (
    <BrowserActionsProvider>
      <div className="h-page-xs flex flex-col">
        <PageHeader
          title={gateway.name}
          breadcrumbs={[
            { label: "Gateways", href: "/home/gateways" },
            { label: gateway.name },
          ]}
          tabs={[
            {
              label: "Info",
              value: "info",
              isActive: isInfo,
              onClick: () => navigate(`/home/gateways/${gateway.id}/info`),
            },
            {
              label: "Terminal",
              value: "terminal",
              isActive: isTerminal,
              onClick: () => navigate(`/home/gateways/${gateway.id}/terminal`),
            },
            {
              label: "Browser",
              value: "browser",
              isActive: isBrowser,
              onClick: () => navigate(`/home/gateways/${gateway.id}/browser`),
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
            ) : null
          }
        />
        <div className="flex flex-1 overflow-hidden">
          <Outlet context={ctx} />
        </div>
        <EditGatewayDialog
          open={editOpen}
          onOpenChange={setEditOpen}
          gatewayId={gateway.id}
          currentBaseUrl={gateway.baseUrl}
          onSaved={() => revalidate()}
        />
        <DeleteGatewayDialog
          open={deleteOpen}
          onOpenChange={setDeleteOpen}
          gatewayId={gateway.id}
          gatewayName={gateway.name}
          onDeleted={() => navigate("/home/gateways")}
        />
      </div>
    </BrowserActionsProvider>
  );
}
