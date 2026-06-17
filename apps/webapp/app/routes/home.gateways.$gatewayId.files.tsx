import { useRef, useState } from "react";
import { FolderOpen, Loader2, Trash2 } from "lucide-react";
import type { Folder } from "@redplanethq/gateway-protocol";
import { useGateway } from "~/components/gateway/gateway-provider";
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
import { cn } from "~/lib/utils";

export default function GatewayFilesTab() {
  const gw = useGateway();

  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(
    gw.folders[0]?.id ?? null,
  );
  const [contextMenuOpen, setContextMenuOpen] = useState(false);
  const [contextMenuFolder, setContextMenuFolder] = useState<Folder | null>(
    null,
  );
  const [folderToDelete, setFolderToDelete] = useState<Folder | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const anchorRef = useRef<HTMLSpanElement>(null);

  const handleContextMenu = (e: React.MouseEvent, folder: Folder) => {
    e.preventDefault();
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
    setDeletingId(folder.id);
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
      if (selectedFolderId === folder.id) {
        const remaining = gw.folders.filter((f) => f.id !== folder.id);
        setSelectedFolderId(remaining[0]?.id ?? null);
      }
      gw.refresh();
    } finally {
      setDeletingId(null);
      setFolderToDelete(null);
    }
  };

  return (
    <div className="flex h-full w-full flex-col gap-2 overflow-y-auto p-4">
      {gw.folders.length === 0 ? (
        <p className="text-muted-foreground py-8 text-center text-sm">
          No folders registered yet. Add one from the Info tab.
        </p>
      ) : (
        gw.folders.map((folder) => (
          <button
            key={folder.id}
            onClick={() => setSelectedFolderId(folder.id)}
            onContextMenu={(e) => handleContextMenu(e, folder)}
            className={cn(
              "flex w-full items-center gap-3 rounded border px-3 py-2 text-left transition-colors",
              folder.id === selectedFolderId
                ? "bg-grayAlpha-100 border-foreground/20"
                : "bg-background-3 hover:bg-grayAlpha-50",
            )}
          >
            <FolderOpen
              size={16}
              className={cn(
                "shrink-0",
                folder.id === selectedFolderId
                  ? "text-foreground"
                  : "text-muted-foreground",
              )}
            />
            <div className="flex min-w-0 flex-1 flex-col">
              <span className="text-sm font-medium">{folder.name}</span>
              <span
                className="text-muted-foreground truncate font-mono text-xs"
                title={folder.path}
              >
                {folder.path}
              </span>
            </div>
            {deletingId === folder.id && (
              <Loader2
                size={12}
                className="text-muted-foreground shrink-0 animate-spin"
              />
            )}
          </button>
        ))
      )}

      {/* Virtual anchor for right-click context menu */}
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
            Delete folder
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Delete confirmation dialog */}
      <AlertDialog
        open={folderToDelete !== null}
        onOpenChange={(open) => {
          if (!open) setFolderToDelete(null);
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
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={handleDeleteConfirm}
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
