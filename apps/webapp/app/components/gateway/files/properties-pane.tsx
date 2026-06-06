import { useEffect, useState } from "react";
import { Bot, FolderOpen, Loader2, Plus, Trash2, X } from "lucide-react";
import { Button } from "~/components/ui/button";
import { AddFolderDialog } from "~/components/gateway/add-folder-dialog";
import {
  useGateway,
  type GatewaySnapshot,
} from "~/components/gateway/gateway-provider";
import { cn } from "~/lib/utils";
import type { FsEntry, FsStat } from "~/services/gateway/fs-scripts.server";
import { EntryIcon } from "./file-icon";
import { formatBytes, formatDateTime, formatMode } from "./format";

interface PropertiesPaneProps {
  gatewayId: string;
  selectedEntry: FsEntry | null;
  selectedEntryPath: string | null;
  onClearSelection: () => void;
}

export function PropertiesPane(props: PropertiesPaneProps) {
  const gw = useGateway();
  return (
    <aside className="bg-background-2 flex h-full flex-col overflow-y-auto border-l">
      {props.selectedEntry && props.selectedEntryPath ? (
        <EntryView
          gatewayId={props.gatewayId}
          entry={props.selectedEntry}
          path={props.selectedEntryPath}
          onClear={props.onClearSelection}
        />
      ) : (
        <GatewayView gateway={gw} />
      )}
    </aside>
  );
}

/* ───────── Gateway view (default — replaces the old /info tab) ───────── */

interface GatewayViewProps {
  gateway: GatewaySnapshot & { refresh: () => void };
}

function GatewayView({ gateway: gw }: GatewayViewProps) {
  const [addFolderOpen, setAddFolderOpen] = useState(false);
  const [removingFolderId, setRemovingFolderId] = useState<string | null>(null);

  const handleRemoveFolder = async (folderId: string) => {
    setRemovingFolderId(folderId);
    try {
      const res = await fetch(`/api/v1/gateways/${gw.id}/folders/${folderId}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        // eslint-disable-next-line no-alert
        alert(body.error ?? `Failed (${res.status})`);
      }
      gw.refresh();
    } finally {
      setRemovingFolderId(null);
    }
  };

  const isDocker = gw.deployMode === "docker";
  const isRailway = gw.deployMode === "railway";
  const isContainer = isDocker || isRailway;
  const deployModeLabel = isRailway
    ? "Railway container"
    : isDocker
      ? "Docker container"
      : "Direct install on host";

  return (
    <div className="flex flex-col gap-5 p-4">
      <Section title="Overview">
        <KvGrid>
          <Kv label="Name" value={gw.name} />
          <Kv
            label="Description"
            value={gw.description ?? "—"}
            italic={!gw.description}
          />
          <Kv
            label="Status"
            value={gw.status === "CONNECTED" ? "Connected" : "Disconnected"}
            valueClassName={cn(
              "font-medium",
              gw.status === "CONNECTED"
                ? "text-success"
                : "text-muted-foreground",
            )}
          />
          {gw.hostname ? (
            <Kv label="Hostname" value={gw.hostname} mono />
          ) : null}
          {gw.platform ? <Kv label="Platform" value={gw.platform} /> : null}
          <Kv label="Deploy mode" value={deployModeLabel} />
        </KvGrid>
      </Section>

      <Section title="Coding agents">
        {gw.agents.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            No coding agents detected.{" "}
            {isContainer
              ? "Update the image to include claude-code or codex-cli."
              : "Install claude-code or codex-cli, then refresh."}
          </p>
        ) : (
          <div className="flex flex-col gap-1.5">
            {gw.agents.map((name) => (
              <div
                key={name}
                className="bg-background-3 flex items-center gap-3 rounded border px-3 py-2"
              >
                <Bot size={18} className="text-foreground shrink-0" />
                <span className="font-medium">{name}</span>
              </div>
            ))}
          </div>
        )}
      </Section>

      <Section
        title="Folders"
        action={
          <Button
            variant="secondary"
            size="sm"
            className="h-7 gap-1.5"
            onClick={() => setAddFolderOpen(true)}
          >
            <Plus size={12} />
            Add
          </Button>
        }
      >
        {gw.folders.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            No folders registered yet.
          </p>
        ) : (
          <div className="flex flex-col gap-1.5">
            {gw.folders.map((f) => (
              <div
                key={f.id}
                className="bg-background-3 flex items-center gap-2 rounded border px-2.5 py-1.5"
              >
                <FolderOpen
                  size={14}
                  className="text-muted-foreground shrink-0"
                />
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="font-medium leading-tight">{f.name}</span>
                  <span className="text-muted-foreground truncate font-mono text-sm leading-tight">
                    {f.path}
                  </span>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="text-muted-foreground hover:text-destructive h-6 w-6"
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
      </Section>

      <AddFolderDialog
        open={addFolderOpen}
        onOpenChange={setAddFolderOpen}
        gatewayId={gw.id}
        onAdded={gw.refresh}
      />
    </div>
  );
}

/* ───────── Entry view (when a file/folder is selected) ───────── */

interface EntryViewProps {
  gatewayId: string;
  entry: FsEntry;
  path: string;
  onClear: () => void;
}

function EntryView({ gatewayId, entry, path, onClear }: EntryViewProps) {
  const [stat, setStat] = useState<FsStat | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setStat(null);
    fetch(`/api/v1/gateways/${gatewayId}/fs/stat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path }),
    })
      .then(async (r) => {
        const body = (await r.json().catch(() => ({}))) as {
          stat?: FsStat;
          error?: string;
        };
        if (cancelled) return;
        if (!r.ok || !body.stat) {
          setError(body.error ?? `Failed (${r.status})`);
          return;
        }
        setStat(body.stat);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [gatewayId, path]);

  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="flex items-start gap-3">
        <EntryIcon
          entry={entry}
          size={36}
          className={cn(
            "mt-0.5 shrink-0",
            entry.type === "dir" ? "text-foreground" : "text-muted-foreground",
          )}
        />
        <div className="min-w-0 flex-1">
          <p className="break-all font-medium leading-tight">{entry.name}</p>
          <p className="text-muted-foreground text-xs capitalize">
            {entry.type === "link" ? "Symbolic link" : entry.type}
          </p>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={onClear}
          title="Clear selection"
        >
          <X size={14} />
        </Button>
      </div>

      <Section title="Location">
        <KvGrid>
          <Kv label="Path" value={path} mono small />
        </KvGrid>
      </Section>

      <Section title="Details">
        {loading ? (
          <div className="text-muted-foreground flex items-center gap-2 text-sm">
            <Loader2 size={12} className="animate-spin" /> Loading…
          </div>
        ) : error ? (
          <p className="text-destructive text-xs">{error}</p>
        ) : stat ? (
          <KvGrid>
            {entry.type !== "dir" ? (
              <Kv label="Size" value={formatBytes(stat.size)} />
            ) : null}
            <Kv label="Mode" value={formatMode(stat.mode)} mono />
            <Kv label="Owner" value={`uid ${stat.uid} · gid ${stat.gid}`} />
            <Kv label="Modified" value={formatDateTime(stat.mtime)} />
            <Kv label="Accessed" value={formatDateTime(stat.atime)} />
            {stat.birthtime > 0 ? (
              <Kv label="Created" value={formatDateTime(stat.birthtime)} />
            ) : null}
            <Kv label="Inode changed" value={formatDateTime(stat.ctime)} />
            {stat.target ? (
              <Kv label="Symlink target" value={stat.target} mono small />
            ) : null}
          </KvGrid>
        ) : null}
      </Section>
    </div>
  );
}

/* ───────── Small shared bits ───────── */

function Section({
  title,
  action,
  children,
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <h3 className="font-medium">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}

function KvGrid({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-[110px_1fr] gap-y-1.5">{children}</div>;
}

function Kv({
  label,
  value,
  mono,
  small,
  italic,
  valueClassName,
}: {
  label: string;
  value: string;
  mono?: boolean;
  small?: boolean;
  italic?: boolean;
  valueClassName?: string;
}) {
  return (
    <>
      <span className="text-muted-foreground">{label}</span>
      <span
        className={cn(
          "break-all",
          mono && "font-mono",
          small && "text-[11px]",
          italic && "text-muted-foreground italic",
          valueClassName,
        )}
      >
        {value}
      </span>
    </>
  );
}
