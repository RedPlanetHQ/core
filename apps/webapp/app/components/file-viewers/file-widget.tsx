import { useState, type CSSProperties } from "react";
import { Download, Loader2 } from "lucide-react";
import { cn } from "~/lib/utils";
import { EntryIcon } from "~/components/gateway/files/file-icon";
import { FileViewer } from "./viewer-host";
import { triggerGatewayDownload } from "./download";

interface GatewayFileWidgetProps {
  gatewayId: string;
  /** Absolute path on the gateway (must resolve to an `exec`-scoped folder). */
  path: string;
  /** Optional display label; defaults to the path's basename. */
  title?: string;
  /** Cap the widget's height so it fits inline in chat. Default 360px. */
  maxHeight?: number | string;
  className?: string;
}

/**
 * Compact inline file widget for chat (or any other narrow embed):
 * filename + download button in the header, `FileViewer` in the body.
 *
 *   <GatewayFileWidget gatewayId="gw_…" path="/repo/README.md" />
 *
 * The widget never assumes the file is previewable — if the file's
 * extension isn't registered, the body shows "Preview not supported"
 * but the header download button still works. The two viewer slots
 * (header + body) are intentionally not deduplicated: a previewable
 * file might still be worth grabbing locally, so the download stays
 * in the header always.
 */
export function GatewayFileWidget({
  gatewayId,
  path,
  title,
  maxHeight = 360,
  className,
}: GatewayFileWidgetProps) {
  const filename = title ?? basename(path);
  const [downloading, setDownloading] = useState(false);

  const handleDownload = async () => {
    setDownloading(true);
    try {
      await triggerGatewayDownload(gatewayId, path, basename(path));
    } catch (err) {
      // eslint-disable-next-line no-alert
      alert(err instanceof Error ? err.message : String(err));
    } finally {
      setDownloading(false);
    }
  };

  const style: CSSProperties = {
    maxHeight: typeof maxHeight === "number" ? `${maxHeight}px` : maxHeight,
  };

  return (
    <div
      className={cn(
        "bg-background-2 flex flex-col overflow-hidden rounded border",
        className,
      )}
      style={style}
    >
      <header className="flex shrink-0 items-center gap-2 border-b px-3 py-1.5">
        <EntryIcon
          entry={{ name: filename, type: "file" }}
          size={14}
          className="text-muted-foreground shrink-0"
        />
        <span className="truncate text-sm font-medium" title={path}>
          {filename}
        </span>
        <button
          type="button"
          disabled={downloading}
          onClick={handleDownload}
          className="text-muted-foreground hover:text-foreground hover:bg-background-3 ml-auto inline-flex h-6 w-6 shrink-0 items-center justify-center rounded transition-colors disabled:opacity-60"
          title={downloading ? "Downloading…" : "Download"}
          aria-label={downloading ? "Downloading" : "Download"}
        >
          {downloading ? (
            <Loader2 size={13} className="animate-spin" />
          ) : (
            <Download size={13} />
          )}
        </button>
      </header>
      <div className="min-h-0 flex-1 overflow-hidden">
        <FileViewer
          gatewayId={gatewayId}
          path={path}
          className="h-full"
        />
      </div>
    </div>
  );
}

function basename(p: string): string {
  const i = p.lastIndexOf("/");
  return i === -1 ? p : p.slice(i + 1) || p;
}
