import { useEffect, useRef, useState } from "react";
import { AlertCircle, Loader2 } from "lucide-react";
import { cn } from "~/lib/utils";
import type { ViewerComponentProps } from "./types";

/**
 * PPTX viewer powered by `pptx-preview` (pure JS, no LibreOffice
 * dependency). Skips the standard text `/fs/read` path
 * (`skipContentFetch: true` in the registry) and fetches the file's
 * raw bytes via `/fs/download` instead, since pptx-preview wants an
 * `ArrayBuffer`.
 *
 * Fidelity is best-effort: simple text/bullet decks render well;
 * complex shapes, animations, embedded media, and custom fonts may
 * not. Failure modes surface inline rather than as cryptic console
 * errors — the user can always fall back to the download button.
 *
 * The library does its DOM work imperatively against a container
 * div, so we keep a ref and tear it down on unmount via `destroy()`.
 * Dynamic-imported to keep its echarts/jszip transitive deps out of
 * the SSR bundle.
 */
export function PptxViewer({ gatewayId, path, className }: ViewerComponentProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let previewer: any = null;

    const load = async () => {
      try {
        const res = await fetch(
          `/api/v1/gateways/${gatewayId}/fs/download?path=${encodeURIComponent(path)}`,
        );
        if (!res.ok) {
          const text = await res.text().catch(() => "");
          throw new Error(text.trim() || `Download failed (${res.status})`);
        }
        const buffer = await res.arrayBuffer();
        if (cancelled || !hostRef.current) return;

        const { init } = await import("pptx-preview");
        const host = hostRef.current;
        // Measure once on mount; the library doesn't reflow on its
        // own, so a parent resize won't re-fit. A follow-up could
        // add a ResizeObserver + re-init.
        const width = host.clientWidth || 800;
        const height = host.clientHeight || 600;

        previewer = init(host, { width, height, mode: "list" });
        await previewer.preview(buffer);
        if (cancelled) {
          previewer.destroy?.();
          previewer = null;
          return;
        }
        setLoading(false);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
        setLoading(false);
      }
    };

    void load();

    return () => {
      cancelled = true;
      previewer?.destroy?.();
    };
  }, [gatewayId, path]);

  return (
    <div className={cn("bg-background-2 relative h-full w-full overflow-auto", className)}>
      <div ref={hostRef} className="h-full w-full" />
      {loading ? (
        <div className="bg-background-2/80 text-muted-foreground absolute inset-0 flex items-center justify-center gap-2 text-sm">
          <Loader2 size={14} className="animate-spin" />
          Loading presentation…
        </div>
      ) : null}
      {error ? (
        <div className="text-destructive absolute inset-0 flex flex-col items-center justify-center gap-2 p-4 text-sm">
          <AlertCircle size={16} />
          <p className="max-w-md text-center">{error}</p>
        </div>
      ) : null}
    </div>
  );
}
