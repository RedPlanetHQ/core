import { json, type LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData, useRevalidator } from "@remix-run/react";
import { useEffect, useState } from "react";
import { SettingSection } from "~/components/setting-section";
import { Card, CardContent } from "~/components/ui/card";
import { Button, buttonVariants } from "~/components/ui";
import { Input } from "~/components/ui/input";
import { Textarea } from "~/components/ui/textarea";
import { Badge } from "~/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "~/components/ui/tooltip";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "~/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "~/components/ui/alert-dialog";
import { requireUser } from "~/services/session.server";
import {
  listGateways,
  refreshWorkspaceGateways,
} from "~/services/gateway.server";
import { fetchManifest } from "~/services/gateway/transport.server";
import {
  Monitor,
  Plus,
  Globe,
  Code2,
  Wrench,
  FolderOpen,
  Bot,
  Trash2,
} from "lucide-react";
import { cn } from "~/lib/utils";

type GatewayManifest = {
  capabilities?: {
    browser?: { enabled?: boolean; engines?: string[] };
  };
  folders?: unknown[];
  tools?: unknown[];
  agents?: string[];
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { workspaceId } = await requireUser(request);

  if (!workspaceId) {
    throw new Error("Workspace not found");
  }

  // No background health poller exists yet — the settings page is the only
  // place that refreshes status. Do it inline on every visit/revalidation
  // so `lastSeenAt`, status, and client metadata stay current.
  await refreshWorkspaceGateways(workspaceId);

  const rows = await listGateways(workspaceId);

  // Manifest is no longer cached on the row; live-fetch for connected
  // gateways so the capability badges (browser engines, tools, folders,
  // agents) reflect what the gateway advertises right now.
  const gateways = await Promise.all(
    rows.map(async (gw) => {
      if (gw.status !== "CONNECTED") {
        return { ...gw, manifest: null };
      }
      const m = await fetchManifest(gw.id, 4_000);
      return { ...gw, manifest: m?.manifest ?? null };
    }),
  );

  return json({ gateways });
}

function isActive(lastSeenAt: string | null, status: string): boolean {
  if (status !== "CONNECTED") return false;
  if (!lastSeenAt) return false;
  return Date.now() - new Date(lastSeenAt).getTime() < 5 * 60 * 1000;
}

function formatAbsolute(lastSeenAt: string | null): string {
  if (!lastSeenAt) return "No heartbeat recorded yet";
  const d = new Date(lastSeenAt);
  return `Last health check at ${d.toLocaleString()}`;
}

function CapabilityBadge({
  icon: Icon,
  label,
  tooltip,
}: {
  icon: React.ComponentType<{ size?: number; className?: string }>;
  label: string;
  tooltip: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge variant="secondary" className="gap-1.5 font-normal">
          <Icon size={14} className="text-muted-foreground" />
          <span className="text-xs">{label}</span>
        </Badge>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs">
        <span className="whitespace-pre-line text-xs">{tooltip}</span>
      </TooltipContent>
    </Tooltip>
  );
}

function RegisterGatewayDialog({ onRegistered }: { onRegistered: () => void }) {
  const [open, setOpen] = useState(false);
  const [baseUrl, setBaseUrl] = useState("");
  const [securityKey, setSecurityKey] = useState("");
  const [status, setStatus] = useState<"idle" | "submitting" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setBaseUrl("");
    setSecurityKey("");
    setStatus("idle");
    setError(null);
  };

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus("submitting");
    setError(null);
    try {
      const res = await fetch("/api/v1/gateways", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          intent: "register",
          baseUrl,
          securityKey,
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? `Request failed (${res.status})`);
        setStatus("error");
        return;
      }
      reset();
      setOpen(false);
      onRegistered();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStatus("error");
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (!v) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button variant="secondary" className="gap-2">
          <Plus size={14} />
          New gateway
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Register a gateway</DialogTitle>
        </DialogHeader>
        <p className="text-muted-foreground text-sm">
          Paste the <code>baseUrl</code> and <code>securityKey</code> printed by{" "}
          <code>corebrain gateway register</code>. The gateway's name is pulled
          from its manifest automatically.
        </p>
        <form
          onSubmit={handleSubmit}
          id="register-gateway-form"
          className="flex flex-col gap-3 py-2"
        >
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium">Base URL</label>
            <Input
              placeholder="https://your-gateway.example.com"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              type="url"
              required
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium">Security key</label>
            <Textarea
              placeholder="gwk_..."
              value={securityKey}
              onChange={(e) => setSecurityKey(e.target.value)}
              rows={2}
              required
              className="font-mono text-xs"
            />
          </div>
          {error ? <p className="text-destructive text-sm">{error}</p> : null}
        </form>
        <DialogFooter className="border-none py-2">
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            type="submit"
            variant="secondary"
            form="register-gateway-form"
            disabled={status === "submitting" || !baseUrl || !securityKey}
          >
            {status === "submitting" ? "Registering..." : "Register"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DeleteGatewayButton({
  gatewayId,
  gatewayName,
  onDeleted,
}: {
  gatewayId: string;
  gatewayName: string;
  onDeleted: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleDelete() {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/gateways/${gatewayId}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? `Request failed (${res.status})`);
        return;
      }
      setOpen(false);
      onDeleted();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AlertDialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (!v) setError(null);
      }}
    >
      <Tooltip>
        <TooltipTrigger asChild>
          <AlertDialogTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground hover:text-destructive h-7 w-7 p-0"
              aria-label="Delete gateway"
            >
              <Trash2 size={14} />
            </Button>
          </AlertDialogTrigger>
        </TooltipTrigger>
        <TooltipContent>
          <span className="text-xs">Delete gateway</span>
        </TooltipContent>
      </Tooltip>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete {gatewayName}?</AlertDialogTitle>
          <AlertDialogDescription>
            This removes the gateway from CORE and disconnects any coding
            sessions that ran through it. The local gateway service will keep
            running — re-register it with{" "}
            <code>corebrain gateway register</code> to reconnect.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {error ? <p className="text-destructive text-sm">{error}</p> : null}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={submitting}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => {
              e.preventDefault();
              handleDelete();
            }}
            disabled={submitting}
            className={buttonVariants({ variant: "destructive" })}
          >
            {submitting ? "Deleting..." : "Delete"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export default function GatewaySettings() {
  const { gateways } = useLoaderData<typeof loader>();
  const { revalidate } = useRevalidator();

  useEffect(() => {
    // Re-probe gateways every 20s while this page is open so Connected /
    // Disconnected state and the "seen Xs ago" label stay honest.
    const visible = () => document.visibilityState === "visible";
    const tick = () => {
      if (visible()) revalidate();
    };
    const id = window.setInterval(tick, 20_000);
    const onFocus = () => tick();
    window.addEventListener("focus", onFocus);
    return () => {
      window.clearInterval(id);
      window.removeEventListener("focus", onFocus);
    };
  }, [revalidate]);

  return (
    <TooltipProvider delayDuration={100}>
      <div className="md:w-3xl mx-auto flex w-auto flex-col gap-4 px-4 py-6">
        <SettingSection
          title="Gateways"
          description="Gateways connect your local machine to CORE, enabling browser, coding, and exec tools."
          actions={<RegisterGatewayDialog onRegistered={revalidate} />}
        >
          {gateways.length === 0 ? (
            <Card>
              <CardContent className="bg-background-2 flex flex-col items-center justify-center py-12">
                <Monitor className="text-muted-foreground mb-4 h-12 w-12" />
                <h3 className="text-lg font-medium">No gateways yet</h3>
                <p className="text-muted-foreground mb-4 text-center">
                  Click <span className="font-medium">New gateway</span> to
                  connect your first machine.
                </p>
                <a
                  href="https://docs.getcore.me/gateway/overview"
                  target="_blank"
                  rel="noreferrer"
                  className={cn(buttonVariants({ variant: "secondary" }))}
                >
                  Learn how to connect a gateway
                </a>
              </CardContent>
            </Card>
          ) : (
            <div className="flex flex-col gap-2">
              {gateways.map((gateway) => {
                const active = isActive(gateway.lastSeenAt, gateway.status);
                const manifest = (gateway.manifest ?? {}) as GatewayManifest;
                const browser = manifest.capabilities?.browser;
                const browserEnabled = browser?.enabled ?? false;
                const engines = browser?.engines ?? [];
                const agents = manifest.agents ?? [];
                const toolCount = Array.isArray(manifest.tools)
                  ? manifest.tools.length
                  : 0;
                const folderCount = Array.isArray(manifest.folders)
                  ? manifest.folders.length
                  : 0;

                const metaBits = [
                  gateway.hostname,
                  gateway.platform,
                  gateway.clientVersion ? `CLI ${gateway.clientVersion}` : null,
                ].filter(Boolean);

                return (
                  <Card key={gateway.id}>
                    <CardContent className="p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex min-w-0 items-center gap-2.5">
                          <div
                            className={cn(
                              "h-2.5 w-2.5 shrink-0 rounded-full",
                              active
                                ? "bg-green-500"
                                : "bg-muted-foreground/40",
                            )}
                          />
                          <p className="truncate font-medium">{gateway.name}</p>
                          {metaBits.length > 0 ? (
                            <span className="text-muted-foreground truncate text-xs">
                              · {metaBits.join(" · ")}
                            </span>
                          ) : null}
                        </div>
                        <div className="flex shrink-0 items-center gap-1">
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span
                                className={cn(
                                  "cursor-default text-xs font-medium",
                                  active
                                    ? "text-green-500"
                                    : "text-muted-foreground",
                                )}
                              >
                                {active ? "Connected" : "Disconnected"}
                              </span>
                            </TooltipTrigger>
                            <TooltipContent>
                              <span className="text-xs">
                                {formatAbsolute(gateway.lastSeenAt)}
                                {gateway.lastHealthError
                                  ? `\n${gateway.lastHealthError}`
                                  : ""}
                              </span>
                            </TooltipContent>
                          </Tooltip>
                          <DeleteGatewayButton
                            gatewayId={gateway.id}
                            gatewayName={gateway.name}
                            onDeleted={revalidate}
                          />
                        </div>
                      </div>

                      {gateway.description ? (
                        <p className="text-muted-foreground ml-5 mt-1 text-xs">
                          {gateway.description}
                        </p>
                      ) : null}

                      <div className="ml-5 mt-2 flex flex-wrap items-center gap-1.5">
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <a
                              href={gateway.baseUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="text-muted-foreground hover:text-foreground max-w-[320px] truncate font-mono text-xs"
                            >
                              {gateway.baseUrl}
                            </a>
                          </TooltipTrigger>
                          <TooltipContent>
                            <span className="font-mono text-xs">
                              {gateway.baseUrl}
                            </span>
                          </TooltipContent>
                        </Tooltip>
                        <span className="text-muted-foreground/50 text-xs">
                          |
                        </span>
                        <CapabilityBadge
                          icon={Globe}
                          label={
                            browserEnabled
                              ? engines.length > 0
                                ? `Browser · ${engines.join(", ")}`
                                : "Browser"
                              : "Browser off"
                          }
                          tooltip={
                            browserEnabled
                              ? `Browser tool enabled${
                                  engines.length > 0
                                    ? ` (engines: ${engines.join(", ")})`
                                    : ""
                                }`
                              : "Browser tool is not enabled on this gateway"
                          }
                        />
                        <CapabilityBadge
                          icon={Bot}
                          label={`${agents.length} ${
                            agents.length === 1 ? "agent" : "agents"
                          }`}
                          tooltip={
                            agents.length > 0
                              ? `Coding agents configured:\n${agents
                                  .map((a) => `• ${a}`)
                                  .join("\n")}`
                              : "No coding agents configured on this gateway"
                          }
                        />
                        <CapabilityBadge
                          icon={Wrench}
                          label={`${toolCount} tools`}
                          tooltip={`${toolCount} tools advertised in the gateway manifest (browser, coding, exec, utils)`}
                        />
                        <CapabilityBadge
                          icon={FolderOpen}
                          label={`${folderCount} ${
                            folderCount === 1 ? "folder" : "folders"
                          }`}
                          tooltip={
                            folderCount > 0
                              ? `${folderCount} folder(s) exposed to CORE via this gateway`
                              : "No folders exposed to CORE by this gateway"
                          }
                        />
                        {!manifest.capabilities ? (
                          <CapabilityBadge
                            icon={Code2}
                            label="No manifest"
                            tooltip="No manifest received from this gateway yet — capabilities unknown"
                          />
                        ) : null}
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </SettingSection>
      </div>
    </TooltipProvider>
  );
}
