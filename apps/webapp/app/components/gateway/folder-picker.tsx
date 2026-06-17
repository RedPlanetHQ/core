import { Check, ChevronDown, FolderOpen, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { Folder } from "@redplanethq/gateway-protocol";

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "~/components/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { Button } from "~/components/ui/button";

export function FolderPicker({
  gatewayId,
  folders,
  selectedFolderId,
  onSelectFolderId,
  onDeleted,
}: {
  gatewayId: string;
  folders: Folder[];
  selectedFolderId: string | null;
  onSelectFolderId: (id: string | null) => void;
  onDeleted?: () => void;
}) {
  const [deleteTarget, setDeleteTarget] = useState<Folder | null>(null);
  const [status, setStatus] = useState<"idle" | "submitting" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  const selectedFolder =
    (selectedFolderId && folders.find((f) => f.id === selectedFolderId)) ?? null;

  const nextFolderId = useMemo(() => {
    if (!deleteTarget) return selectedFolderId;
    const remaining = folders.filter((f) => f.id !== deleteTarget.id);
    if (remaining.length === 0) return null;
    // Prefer to keep current selection if it's not the deleted one.
    const stillSelected = remaining.some((f) => f.id === selectedFolderId);
    if (stillSelected) return selectedFolderId;
    return remaining[0]!.id;
  }, [deleteTarget, folders, selectedFolderId]);

  useEffect(() => {
    if (deleteTarget) {
      setStatus("idle");
      setError(null);
    }
  }, [deleteTarget]);

  async function handleConfirmDelete() {
    if (!deleteTarget) return;

    setStatus("submitting");
    setError(null);
    try {
      // Auto-switch immediately so UI doesn't point at a soon-to-be-invalid id.
      if (selectedFolderId === deleteTarget.id) {
        onSelectFolderId(nextFolderId);
      }

      const res = await fetch(
        `/api/v1/gateways/${gatewayId}/folders/${deleteTarget.id}`,
        { method: "DELETE" },
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? `Request failed (${res.status})`);
        setStatus("error");
        return;
      }

      setDeleteTarget(null);
      onDeleted?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStatus("error");
    }
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="secondary"
            size="sm"
            className="min-w-0 max-w-[520px] justify-between gap-2"
          >
            {selectedFolder ? (
              <span className="flex min-w-0 items-center gap-2">
                <FolderOpen
                  size={14}
                  className="text-muted-foreground shrink-0"
                />
                <span className="truncate font-medium">{selectedFolder.name}</span>
                <span
                  className="text-muted-foreground truncate font-mono text-xs"
                  title={selectedFolder.path}
                >
                  {selectedFolder.path}
                </span>
              </span>
            ) : (
              <span className="text-muted-foreground">No folder selected</span>
            )}
            <ChevronDown size={14} className="text-muted-foreground shrink-0" />
          </Button>
        </DropdownMenuTrigger>

        <DropdownMenuContent align="start" className="w-[520px]">
          {folders.length === 0 ? (
            <div className="text-muted-foreground px-2 py-1.5 text-sm">
              No folders registered.
            </div>
          ) : (
            folders.map((f) => (
              <DropdownMenuItem
                key={f.id}
                className="group flex items-center gap-2"
                onSelect={(e) => {
                  e.preventDefault();
                  onSelectFolderId(f.id);
                }}
              >
                <FolderOpen
                  size={14}
                  className="text-muted-foreground shrink-0"
                />
                <span className="min-w-0 flex-1 truncate">
                  <span className="font-medium">{f.name}</span>
                  <span
                    className="text-muted-foreground ml-2 font-mono text-xs"
                    title={f.path}
                  >
                    {f.path}
                  </span>
                </span>
                {selectedFolderId === f.id ? (
                  <Check size={14} className="shrink-0" />
                ) : null}

                {/* Context-ish menu: show delete action on hover + allow right-click */}
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="text-muted-foreground hover:text-destructive h-6 w-6 opacity-0 transition-opacity group-hover:opacity-100"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setDeleteTarget(f);
                  }}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setDeleteTarget(f);
                  }}
                  title="Delete folder"
                >
                  <Trash2 size={12} />
                </Button>
              </DropdownMenuItem>
            ))
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={(v) => {
          if (!v) setDeleteTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete folder?</AlertDialogTitle>
            <AlertDialogDescription>
              This will unregister the folder from the gateway. Files on disk will
              not be deleted.
              {deleteTarget ? (
                <span className="mt-2 block">
                  <span className="font-medium">{deleteTarget.name}</span>
                  <span className="text-muted-foreground ml-2 font-mono text-xs">
                    {deleteTarget.path}
                  </span>
                </span>
              ) : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {error ? <p className="text-destructive text-sm">{error}</p> : null}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={status === "submitting"}>
              Cancel
            </AlertDialogCancel>
            <Button
              variant="destructive"
              onClick={handleConfirmDelete}
              disabled={status === "submitting"}
            >
              {status === "submitting" ? "Deleting…" : "Delete"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
