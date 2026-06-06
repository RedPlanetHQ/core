import { useEffect, useMemo, useState } from "react";
import { useGateway } from "~/components/gateway/gateway-provider";
import { FilesPane } from "~/components/gateway/files/files-pane";
import { PropertiesPane } from "~/components/gateway/files/properties-pane";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "~/components/ui/resizable";
import type { FsEntry } from "~/services/gateway/fs-scripts.server";

/**
 * Finder-style file browser for the gateway. Lists registered folders
 * with the `exec` scope and lets the user descend via the inline Node
 * lister script. Single-click selects (right pane shows props),
 * double-click on a folder descends, double-click on a file replaces
 * the listing with an in-pane preview — click the breadcrumb back to
 * any parent dir to return to the listing.
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

  const selectedEntryPath =
    currentPath && selectedEntry
      ? currentPath.replace(/\/+$/, "") + "/" + selectedEntry.name
      : null;

  return (
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
  );
}
