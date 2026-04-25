import { useOutletContext } from "@remix-run/react";
import { useState } from "react";
import {
  Bot,
  CheckCircle2,
  FolderOpen,
  Loader2,
  Plus,
  Trash2,
} from "lucide-react";
import { Button } from "~/components/ui/button";
import { Badge } from "~/components/ui/badge";
import { AddFolderDialog } from "~/components/gateway/add-folder-dialog";
import { cn } from "~/lib/utils";
import type { GatewayOutletContext } from "./home.gateways.$gatewayId";

export default function GatewayInfoTab() {
  const ctx = useOutletContext<GatewayOutletContext>();
  const [addFolderOpen, setAddFolderOpen] = useState(false);
  const [removingFolderId, setRemovingFolderId] = useState<string | null>(null);

  const handleRemoveFolder = async (folderId: string) => {
    setRemovingFolderId(folderId);
    try {
      const res = await fetch(
        `/api/v1/gateways/${ctx.gatewayId}/folders/${folderId}`,
        { method: "DELETE" },
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        // eslint-disable-next-line no-alert
        alert(body.error ?? `Failed (${res.status})`);
      }
      ctx.refresh();
    } finally {
      setRemovingFolderId(null);
    }
  };

  const isDocker = ctx.deployMode === "docker";

  return (
    <div className="md:w-3xl mx-auto flex w-auto flex-col gap-6 px-4 py-6">
      {/* ── Identity ── */}
      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-medium">Overview</h2>
        <div className="grid grid-cols-[140px_1fr] gap-y-2 text-sm">
          <span className="text-muted-foreground">Status</span>
          <span
            className={cn(
              "font-medium",
              ctx.status === "CONNECTED"
                ? "text-success"
                : "text-muted-foreground",
            )}
          >
            {ctx.status === "CONNECTED" ? "Connected" : "Disconnected"}
          </span>
          {ctx.hostname ? (
            <>
              <span className="text-muted-foreground">Hostname</span>
              <span className="font-mono text-xs">{ctx.hostname}</span>
            </>
          ) : null}
          {ctx.platform ? (
            <>
              <span className="text-muted-foreground">Platform</span>
              <span>{ctx.platform}</span>
            </>
          ) : null}
          <span className="text-muted-foreground">Deploy mode</span>
          <span>
            {isDocker ? "Docker container" : "Direct install on host"}
          </span>
        </div>
      </section>

      {/* ── Agents ── */}
      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-medium">Coding agents</h2>
        </div>

        {ctx.availableAgents.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            No coding agents detected on this gateway.{" "}
            {isDocker
              ? "Update the image to include claude-code or codex-cli."
              : "Install claude-code or codex-cli, then re-open this page."}
          </p>
        ) : (
          <div className="flex flex-col gap-1.5">
            {ctx.availableAgents
              .filter((a) => a.configured)
              .map((a) => {
                return (
                  <div
                    key={a.name}
                    className="bg-background-3 flex items-center gap-3 rounded border px-3 py-2"
                  >
                    <Bot
                      size={22}
                      className={cn("shrink-0", "text-foreground")}
                    />
                    <div className="flex min-w-0 flex-1 flex-col">
                      <span className="font-medium">{a.name}</span>
                      <span className="text-muted-foreground truncate font-mono text-xs">
                        {a.path}
                      </span>
                    </div>
                  </div>
                );
              })}
          </div>
        )}
      </section>

      {/* ── Folders ── */}
      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-medium">Folders</h2>
          <Button
            variant="secondary"
            size="sm"
            className="gap-1.5"
            onClick={() => setAddFolderOpen(true)}
          >
            <Plus size={12} />
            Add folder
          </Button>
        </div>

        {ctx.folders.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            No folders registered yet.
          </p>
        ) : (
          <div className="flex flex-col gap-1.5">
            {ctx.folders.map((f) => (
              <div
                key={f.id}
                className="bg-background-3 flex items-center gap-3 rounded border px-3 py-2"
              >
                <FolderOpen
                  size={16}
                  className="text-muted-foreground shrink-0"
                />
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="font-medium">{f.name}</span>
                  <span className="text-muted-foreground truncate font-mono text-xs">
                    {f.path}
                  </span>
                </div>

                <Button
                  variant="ghost"
                  size="icon"
                  className="text-muted-foreground hover:text-destructive h-7 w-7"
                  disabled={removingFolderId === f.id}
                  onClick={() => handleRemoveFolder(f.id)}
                  title="Unregister folder"
                >
                  {removingFolderId === f.id ? (
                    <Loader2 size={12} className="animate-spin" />
                  ) : (
                    <Trash2 size={12} />
                  )}
                </Button>
              </div>
            ))}
          </div>
        )}
      </section>

      <AddFolderDialog
        open={addFolderOpen}
        onOpenChange={setAddFolderOpen}
        gatewayId={ctx.gatewayId}
        isDocker={isDocker}
        onAdded={ctx.refresh}
      />
    </div>
  );
}
