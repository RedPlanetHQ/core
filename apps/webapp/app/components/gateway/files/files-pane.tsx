import { useEffect, useState } from "react";
import {
  ChevronRight,
  Download,
  Eye,
  EyeOff,
  Loader2,
  RefreshCcw,
} from "lucide-react";
import type { Folder } from "@redplanethq/gateway-protocol";
import { Button } from "~/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { cn } from "~/lib/utils";
import { FileViewer, triggerGatewayDownload } from "~/components/file-viewers";
import type { FsEntry } from "~/services/gateway/fs-scripts.server";
import { EntryIcon } from "./file-icon";
import { formatBytes, formatRelative } from "./format";

interface FilesPaneProps {
  gatewayId: string;
  /** Folders with `exec` scope — the only ones we can browse. */
  roots: Folder[];
  selectedRootId: string | null;
  onSelectRoot: (id: string) => void;
  currentPath: string | null;
  onNavigate: (path: string) => void;
  selectedEntryName: string | null;
  onSelectEntry: (entry: FsEntry | null) => void;
  /** Absolute path of the file currently being previewed, or null for directory view. */
  viewingFilePath: string | null;
  onOpenFile: (path: string, entry: FsEntry) => void;
  onCloseFile: () => void;
}

interface ListResponse {
  entries?: FsEntry[];
  error?: string;
}

export function FilesPane({
  gatewayId,
  roots,
  selectedRootId,
  onSelectRoot,
  currentPath,
  onNavigate,
  selectedEntryName,
  onSelectEntry,
  viewingFilePath,
  onOpenFile,
  onCloseFile,
}: FilesPaneProps) {
  const [entries, setEntries] = useState<FsEntry[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showHidden, setShowHidden] = useState(false);
  const [reloadCounter, setReloadCounter] = useState(0);
  // Name of the entry currently being "opened" (descended or previewed).
  // Drives the per-row spinner so the user gets feedback between
  // double-click and the new view rendering. Cleared once the fetch
  // settles or the file viewer takes over.
  const [navigatingName, setNavigatingName] = useState<string | null>(null);
  // Set of entry names currently downloading. Per-row spinner replaces
  // the Download icon while the chunked /fs/download fetch runs.
  const [downloading, setDownloading] = useState<Set<string>>(new Set());

  const markDownloading = (name: string, on: boolean) => {
    setDownloading((prev) => {
      const next = new Set(prev);
      if (on) next.add(name);
      else next.delete(name);
      return next;
    });
  };

  const handleDownload = async (name: string, fullPath: string) => {
    markDownloading(name, true);
    try {
      await triggerGatewayDownload(gatewayId, fullPath, name);
    } catch (err) {
      // eslint-disable-next-line no-alert
      alert(err instanceof Error ? err.message : String(err));
    } finally {
      markDownloading(name, false);
    }
  };

  const root = roots.find((r) => r.id === selectedRootId) ?? null;
  const isViewingFile = viewingFilePath !== null;

  useEffect(() => {
    if (!currentPath) {
      setEntries(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`/api/v1/gateways/${gatewayId}/fs/list`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: currentPath }),
    })
      .then(async (r) => {
        const body = (await r.json().catch(() => ({}))) as ListResponse;
        if (cancelled) return;
        if (!r.ok || !body.entries) {
          setEntries([]);
          setError(body.error ?? `Failed (${r.status})`);
          return;
        }
        setEntries(body.entries);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
        setEntries([]);
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
        setNavigatingName(null);
      });
    return () => {
      cancelled = true;
    };
  }, [gatewayId, currentPath, reloadCounter]);

  // File viewer taking over hides the listing — clear the row spinner
  // so we don't carry a stale name forward when the user returns.
  useEffect(() => {
    if (viewingFilePath) setNavigatingName(null);
  }, [viewingFilePath]);

  const visible = (entries ?? [])
    .filter((e) => showHidden || !e.name.startsWith("."))
    .sort((a, b) => {
      const ad = a.type === "dir" ? 0 : 1;
      const bd = b.type === "dir" ? 0 : 1;
      if (ad !== bd) return ad - bd;
      return a.name.localeCompare(b.name);
    });

  // Breadcrumb shows the file's name as a trailing segment in viewer
  // mode; clicking back-off through it returns to the directory.
  const breadcrumbFileName = viewingFilePath
    ? basename(viewingFilePath)
    : null;

  const handleNavigateFromBreadcrumb = (p: string) => {
    if (isViewingFile) onCloseFile();
    onSelectEntry(null);
    onNavigate(p);
  };

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      {/* Header: root picker + breadcrumb + actions */}
      <div className="flex shrink-0 items-center gap-2 border-b px-3 py-2">
        {roots.length === 0 ? (
          <span className="text-muted-foreground text-sm">
            No folders registered with the <code>exec</code> scope.
          </span>
        ) : (
          <>
            <Select
              value={selectedRootId ?? undefined}
              onValueChange={onSelectRoot}
            >
              <SelectTrigger className="h-7 w-auto min-w-[10rem] gap-1.5">
                <SelectValue placeholder="Pick a folder" />
              </SelectTrigger>
              <SelectContent>
                {roots.map((f) => (
                  <SelectItem key={f.id} value={f.id}>
                    <span className="font-medium">{f.name}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {root && currentPath ? (
              <Breadcrumb
                rootPath={root.path}
                currentPath={currentPath}
                trailingFile={breadcrumbFileName}
                onNavigate={handleNavigateFromBreadcrumb}
              />
            ) : null}

            <div className="ml-auto flex items-center gap-1">
              {!isViewingFile ? (
                <>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    title={
                      showHidden ? "Hide hidden files" : "Show hidden files"
                    }
                    onClick={() => setShowHidden((v) => !v)}
                  >
                    {showHidden ? <EyeOff size={14} /> : <Eye size={14} />}
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    title="Refresh"
                    disabled={!currentPath || loading}
                    onClick={() => setReloadCounter((n) => n + 1)}
                  >
                    {loading ? (
                      <Loader2 size={14} className="animate-spin" />
                    ) : (
                      <RefreshCcw size={14} />
                    )}
                  </Button>
                </>
              ) : null}
            </div>
          </>
        )}
      </div>

      {/* Body: file viewer or entries list */}
      <div className="min-h-0 flex-1 overflow-hidden">
        {isViewingFile && viewingFilePath ? (
          <FileViewer
            key={viewingFilePath}
            gatewayId={gatewayId}
            path={viewingFilePath}
            className="h-full"
          />
        ) : !currentPath ? (
          <EmptyMessage text="Pick a folder above to start browsing." />
        ) : loading && !entries ? (
          <div className="text-muted-foreground flex h-full items-center justify-center gap-2 text-sm">
            <Loader2 size={14} className="animate-spin" />
            Loading…
          </div>
        ) : error ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 p-4 text-sm">
            <p className="text-destructive max-w-md text-center">{error}</p>
            <Button
              variant="secondary"
              size="sm"
              className="gap-1.5"
              onClick={() => setReloadCounter((n) => n + 1)}
            >
              <RefreshCcw size={12} />
              Try again
            </Button>
          </div>
        ) : visible.length === 0 ? (
          <EmptyMessage text="This folder is empty." />
        ) : (
          <ul className="h-full divide-y overflow-auto">
            {visible.map((entry) => {
              const isSelected = entry.name === selectedEntryName;
              const isDir = entry.type === "dir";
              const isNavigating = navigatingName === entry.name;
              const fullPath = joinPath(currentPath, entry.name);
              return (
                <li key={entry.name} className="group/row relative">
                  <button
                    type="button"
                    className={cn(
                      "flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm transition-colors",
                      isSelected
                        ? "bg-accent text-accent-foreground"
                        : "hover:bg-background-3",
                    )}
                    onClick={() => onSelectEntry(entry)}
                    onDoubleClick={() => {
                      setNavigatingName(entry.name);
                      if (isDir) {
                        onSelectEntry(null);
                        onNavigate(fullPath);
                      } else {
                        onOpenFile(fullPath, entry);
                      }
                    }}
                  >
                    {isNavigating ? (
                      <Loader2
                        size={16}
                        className="text-muted-foreground shrink-0 animate-spin"
                      />
                    ) : (
                      <EntryIcon
                        entry={entry}
                        size={16}
                        className={cn(
                          "shrink-0",
                          isDir
                            ? "text-foreground"
                            : "text-muted-foreground",
                        )}
                      />
                    )}
                    <span className="truncate">{entry.name}</span>
                    <span className="text-muted-foreground ml-auto shrink-0 text-xs">
                      {isDir ? "—" : formatBytes(entry.size)}
                    </span>
                    <span className="text-muted-foreground w-20 shrink-0 text-right text-xs">
                      {formatRelative(entry.mtime)}
                    </span>
                    {/* Reserve gutter so the metadata columns don't
                        shift when the download button shows. */}
                    {!isDir ? <span className="w-7 shrink-0" /> : null}
                  </button>
                  {!isDir ? (
                    (() => {
                      const isDownloading = downloading.has(entry.name);
                      return (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            if (!isDownloading) {
                              void handleDownload(entry.name, fullPath);
                            }
                          }}
                          onDoubleClick={(e) => e.stopPropagation()}
                          disabled={isDownloading}
                          className={cn(
                            "text-muted-foreground hover:text-foreground hover:bg-background-3 absolute right-2 top-1/2 inline-flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded transition-opacity",
                            // Stay visible while downloading even if the
                            // pointer leaves the row, so the user can see
                            // the progress to completion.
                            isDownloading
                              ? "opacity-100"
                              : "opacity-0 focus-visible:opacity-100 group-hover/row:opacity-100",
                          )}
                          title={
                            isDownloading
                              ? `Downloading ${entry.name}…`
                              : `Download ${entry.name}`
                          }
                          aria-label={
                            isDownloading
                              ? `Downloading ${entry.name}`
                              : `Download ${entry.name}`
                          }
                        >
                          {isDownloading ? (
                            <Loader2 size={13} className="animate-spin" />
                          ) : (
                            <Download size={13} />
                          )}
                        </button>
                      );
                    })()
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

function EmptyMessage({ text }: { text: string }) {
  return (
    <div className="text-muted-foreground flex h-full items-center justify-center text-sm">
      {text}
    </div>
  );
}

interface BreadcrumbProps {
  rootPath: string;
  currentPath: string;
  /** When set, appended as a non-clickable trailing segment (the file being viewed). */
  trailingFile: string | null;
  onNavigate: (path: string) => void;
}

function Breadcrumb({
  rootPath,
  currentPath,
  trailingFile,
  onNavigate,
}: BreadcrumbProps) {
  const trimmedRoot = rootPath.replace(/\/+$/, "");
  const inside = currentPath.startsWith(trimmedRoot)
    ? currentPath.slice(trimmedRoot.length).replace(/^\/+/, "")
    : "";
  const segments = inside ? inside.split("/") : [];

  return (
    <div className="text-muted-foreground flex min-w-0 items-center gap-1 text-xs">
      <button
        type="button"
        className="hover:text-foreground truncate font-mono"
        onClick={() => onNavigate(trimmedRoot)}
        title={trimmedRoot}
      >
        {basename(trimmedRoot)}
      </button>
      {segments.map((seg, i) => {
        const upto = trimmedRoot + "/" + segments.slice(0, i + 1).join("/");
        return (
          <span key={upto} className="flex items-center gap-1">
            <ChevronRight size={10} className="opacity-60" />
            <button
              type="button"
              className="hover:text-foreground truncate"
              onClick={() => onNavigate(upto)}
            >
              {seg}
            </button>
          </span>
        );
      })}
      {trailingFile ? (
        <span className="flex items-center gap-1">
          <ChevronRight size={10} className="opacity-60" />
          <span className="text-foreground truncate" title={trailingFile}>
            {trailingFile}
          </span>
        </span>
      ) : null}
    </div>
  );
}

function joinPath(dir: string, name: string): string {
  return dir.replace(/\/+$/, "") + "/" + name;
}

function basename(p: string): string {
  const i = p.lastIndexOf("/");
  return i === -1 ? p : p.slice(i + 1) || "/";
}
