import { useEffect, useMemo, useRef, useState } from "react";
import { Trash2 } from "lucide-react";
import type { Folder } from "@redplanethq/gateway-protocol";
import { useGateway } from "~/components/gateway/gateway-provider";
import { FilesPane } from "~/components/gateway/files/files-pane";
import { PropertiesPane } from "~/components/gateway/files/properties-pane";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "~/components/ui/resizable";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "~/components/ui/alert-dialog";
import type { FsEntry } from "~/services/gateway/fs-scripts.server";

/**
 * Finder-style file browser for the gateway. Lists registered folders
 * with the `exec` scope and lets the user descend via the inline Node
 * lister script. Single-click selects (right pane shows props),
 * double-click on a folder descends, double-click on a file replaces
 * the listing with an in-pane preview — click the breadcrumb back to
 * any parent dir to return to the listing.
 *
 * Right-click on a folder in the picker opens a context menu to
 * unregister that folder from the gateway (files on disk untouched).
 */
export default function GatewayFilesTab() {
  const gw = useGateway();

  const execRoots = useMemo(
    () => gw.folders.filter((f) => f.scopes.includes("exec")),
    [gw.folders],
  );

  const lsKey = `core.gateway.${gw.id}.files.lastRoot`;

  const [selectedRootId, setSelectedRootId] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    return window.localStorage.getItem(lsKey);
  });
  const [currentPath, setCurrentPath] = useState<string | null>(null);
  const [selectedEntry, setSelectedEntry] = useState<FsEntry | null>(null);
  const [viewingFilePath, setViewingFilePath] = useState<string | null>(null);

  // Folder context-menu state. Uses a virtual-anchor DropdownMenu so we
  // can position it at the cursor without wrapping every SelectItem in
  // a ContextMenu (which collides with Radix Select's event handling).
  const [contextMenuOpen, setContextMenuOpen] = useState(false);
  const [contextMenuFolder, setContextMenuFolder] = useState<Folder | null>(
    null,
  );
  const [folderToDelete, setFolderToDelete] = useState<Folder | null>(null);
  const [deleting, setDeleting] = useState(false);
  const anchorRef = useRef<HTMLSpanElement>(null);

  // Reconcile the selected root against what's currently registered:
  // - if no roots, clear.
  // - if stored root no longer exists, fall back to the first available one.
  useEffect(() => {
    if (execRoots.length === 0) {
      if (selectedRootId !== null) setSelectedRootId(null);
      if (currentPath !== null) setCurrentPath(null);
      if (viewingFilePath !== null) setViewingFilePath(null);
      return;
    }
    const found = execRoots.find((r) => r.id === selectedRootId);
    if (!found) {
      const first = execRoots[0]!;
      setSelectedRootId(first.id);
      setCurrentPath(first.path);
      setSelectedEntry(null);
      setViewingFilePath(null);
      return;
    }
    if (currentPath === null) {
      setCurrentPath(found.path);
    }
  }, [execRoots, selectedRootId, currentPath, viewingFilePath]);

  const handleSelectRoot = (id: string) => {
    const folder = execRoots.find((r) => r.id === id);
    if (!folder) return;
    setSelectedRootId(id);
    setCurrentPath(folder.path);
    setSelectedEntry(null);
    setViewingFilePath(null);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(lsKey, id);
    }
  };

  const handleFolderContextMenu = (e: React.MouseEvent, folder: Folder) => {
    e.preventDefault();
    e.stopPropagation();
    if (anchorRef.current) {
      anchorRef.current.style.left = `${e.clientX}px`;
      anchorRef.current.style.top = `${e.clientY}px`;
    }
    setContextMenuFolder(folder);
    setContextMenuOpen(true);
  };

  const handleDeleteConfirm = async () => {
    const folder = folderToDelete;
    if (!folder) return;
    setDeleting(true);
    try {
      const res = await fetch(
        `/api/v1/gateways/${gw.id}/folders/${folder.id}`,
        { method: "DELETE" },
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        // eslint-disable-next-line no-alert
        alert(body.error ?? `Failed (${res.status})`);
        return;
      }
      // If we deleted the currently-browsed root, clear browsing state so
      // the reconcile effect picks the next available exec root.
      if (selectedRootId === folder.id) {
        setSelectedRootId(null);
        setCurrentPath(null);
        setSelectedEntry(null);
        setViewingFilePath(null);
        if (typeof window !== "undefined") {
          window.localStorage.removeItem(lsKey);
        }
      }
      gw.refresh();
    } finally {
      setDeleting(false);
      setFolderToDelete(null);
    }
  };

  const selectedEntryPath =
    currentPath && selectedEntry
      ? currentPath.replace(/\/+$/, "") + "/" + selectedEntry.name
      : null;

  return (
    <>
      <ResizablePanelGroup
        orientation="horizontal"
        className="flex-1 overflow-hidden"
      >
        <ResizablePanel id="files" defaultSize="65%" minSize="30%">
          <FilesPane
            gatewayId={gw.id}
            roots={execRoots}
            selectedRootId={selectedRootId}
            onSelectRoot={handleSelectRoot}
            onFolderContextMenu={handleFolderContextMenu}
            currentPath={currentPath}
            onNavigate={(p) => {
              setCurrentPath(p);
              setSelectedEntry(null);
              setViewingFilePath(null);
            }}
            selectedEntryName={selectedEntry?.name ?? null}
            onSelectEntry={setSelectedEntry}
            viewingFilePath={viewingFilePath}
            onOpenFile={(p, entry) => {
              setViewingFilePath(p);
              setSelectedEntry(entry);
            }}
            onCloseFile={() => setViewingFilePath(null)}
          />
        </ResizablePanel>
        <ResizableHandle withHandle />
        <ResizablePanel
          id="properties"
          defaultSize="35%"
          minSize="20%"
          maxSize="60%"
        >
          <PropertiesPane
            gatewayId={gw.id}
            selectedEntry={selectedEntry}
            selectedEntryPath={selectedEntryPath}
            onClearSelection={() => setSelectedEntry(null)}
          />
        </ResizablePanel>
      </ResizablePanelGroup>

      {/* Virtual anchor for the right-click context menu on a folder. */}
      <DropdownMenu open={contextMenuOpen} onOpenChange={setContextMenuOpen}>
        <DropdownMenuTrigger asChild>
          <span
            ref={anchorRef}
            style={{
              position: "fixed",
              width: 0,
              height: 0,
              pointerEvents: "none",
            }}
          />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuItem
            className="text-destructive focus:text-destructive gap-2"
            onSelect={() => {
              setFolderToDelete(contextMenuFolder);
              setContextMenuOpen(false);
            }}
          >
            <Trash2 size={13} />
            Remove folder
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Delete confirmation dialog. */}
      <AlertDialog
        open={folderToDelete !== null}
        onOpenChange={(open) => {
          if (!open && !deleting) setFolderToDelete(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove folder?</AlertDialogTitle>
            <AlertDialogDescription>
              <strong>{folderToDelete?.name}</strong> will be unregistered from
              this gateway. Files on disk are not affected.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={deleting}
              onClick={handleDeleteConfirm}
            >
              {deleting ? "Removing…" : "Remove"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
