import { useMemo } from "react";
import { AlertCircle, Loader2 } from "lucide-react";
import { cn } from "~/lib/utils";
import { useFileContent } from "./use-file-content";
import { pickViewer } from "./registry";
import type { FileViewerProps, ViewerInfo } from "./types";

function basename(p: string): string {
  const i = p.lastIndexOf("/");
  return i === -1 ? p : p.slice(i + 1) || p;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Public file-viewer host. Drop in anywhere with `{ gatewayId, path }`
 * — Gateway Files tab, chat replies, task drawers — and it picks the
 * right viewer for the extension, loads contents via `/fs/read`, and
 * surfaces loading / error / truncation states uniformly.
 *
 * If no viewer applies (binary types — pdf, png, pptx, zip, …) we
 * short-circuit with a "Preview not supported" message and skip the
 * content fetch entirely. That keeps binary files from spamming the
 * gateway with reads that would just be discarded.
 *
 * Viewers themselves are pure components driven by `ViewerComponentProps`
 * (see `./types.ts`). Add new ones via `./registry.ts`.
 */
export function FileViewer({
  gatewayId,
  path,
  className,
  maxBytes,
}: FileViewerProps) {
  const viewer = useMemo(() => pickViewer(basename(path)), [path]);

  if (!viewer) {
    return (
      <div
        className={cn(
          "text-muted-foreground flex h-full items-center justify-center p-4 text-center text-sm",
          className,
        )}
      >
        Preview not supported for this file type.
      </div>
    );
  }

  // Binary viewers (PPTX today, PDF / images later) skip the text
  // `/fs/read` fetch and pull their own bytes via `/fs/download`.
  if (viewer.skipContentFetch) {
    const Component = viewer.component;
    return (
      <div className={cn("flex h-full min-h-0 flex-col", className)}>
        <div className="min-h-0 flex-1 overflow-hidden">
          <Component gatewayId={gatewayId} path={path} />
        </div>
      </div>
    );
  }

  return (
    <FileViewerWithContent
      gatewayId={gatewayId}
      path={path}
      viewer={viewer}
      className={className}
      maxBytes={maxBytes}
    />
  );
}

interface InnerProps {
  gatewayId: string;
  path: string;
  viewer: ViewerInfo;
  className?: string;
  maxBytes?: number;
}

function FileViewerWithContent({
  gatewayId,
  path,
  viewer,
  className,
  maxBytes,
}: InnerProps) {
  const { content, loading, error } = useFileContent(
    gatewayId,
    path,
    maxBytes,
  );

  if (loading) {
    return (
      <div
        className={cn(
          "text-muted-foreground flex h-full items-center justify-center gap-2 text-sm",
          className,
        )}
      >
        <Loader2 size={14} className="animate-spin" />
        Loading…
      </div>
    );
  }

  if (error) {
    return (
      <div
        className={cn(
          "text-destructive flex h-full flex-col items-center justify-center gap-2 p-4 text-sm",
          className,
        )}
      >
        <AlertCircle size={16} />
        <p className="max-w-md text-center">{error}</p>
      </div>
    );
  }

  if (!content) return null;

  const Component = viewer.component;

  return (
    <div className={cn("flex h-full min-h-0 flex-col", className)}>
      {content.truncated ? (
        <div className="bg-warning/10 text-warning border-warning/30 shrink-0 border-b px-4 py-1.5 text-xs">
          Preview truncated — showing {formatBytes(content.readBytes)} of{" "}
          {formatBytes(content.totalBytes)}.
        </div>
      ) : null}
      <div className="min-h-0 flex-1 overflow-auto">
        <Component gatewayId={gatewayId} path={path} content={content} />
      </div>
    </div>
  );
}
