import { useEffect, useState } from "react";
import DocViewer, { DocViewerRenderers } from "@cyntler/react-doc-viewer";
import { AlertCircle, Loader2 } from "lucide-react";
import { cn } from "~/lib/utils";
import type { ViewerComponentProps } from "./types";

/**
 * Office document viewer (PPTX / DOCX / XLSX) powered by
 * @cyntler/react-doc-viewer's MSDocRenderer, which embeds the file
 * via the Microsoft Office Online Viewer.
 *
 * Office Online fetches the file directly from a public URL — it
 * can't carry our session cookie. So on mount we mint a short-lived
 * signed URL via POST /fs/signed-url (auth-gated, 5 min HMAC token)
 * and hand THAT URL to DocViewer. The matching public route
 * /api/v1/fs/signed/:token/:filename streams the bytes inline.
 *
 * Privacy note (worth surfacing if it ever matters): Microsoft sees
 * the file contents during render. Token expires fast (5 min) and
 * scopes to (workspaceId, gatewayId, path) — but the URL is fetched
 * by an external server while it's live.
 *
 * Skips the standard /fs/read text path (`skipContentFetch: true` in
 * the registry) since DocViewer just needs the URL.
 */
function basename(p: string): string {
  const i = p.lastIndexOf("/");
  return i === -1 ? p : p.slice(i + 1) || p;
}

function fileTypeFromPath(p: string): string {
  const i = p.lastIndexOf(".");
  return i === -1 ? "" : p.slice(i + 1).toLowerCase();
}

interface SignedUrlResponse {
  url?: string;
  expiresAt?: number;
  error?: string;
}

export function OfficeViewer({ gatewayId, path, className }: ViewerComponentProps) {
  const [signedUrl, setSignedUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setSignedUrl(null);

    fetch(`/api/v1/gateways/${gatewayId}/fs/signed-url`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path }),
    })
      .then(async (res) => {
        const body = (await res.json().catch(() => ({}))) as SignedUrlResponse;
        if (cancelled) return;
        if (!res.ok || !body.url) {
          throw new Error(body.error ?? `Failed (${res.status})`);
        }
        setSignedUrl(body.url);
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

  if (loading) {
    return (
      <div
        className={cn(
          "text-muted-foreground flex h-full items-center justify-center gap-2 text-sm",
          className,
        )}
      >
        <Loader2 size={14} className="animate-spin" />
        Preparing preview…
      </div>
    );
  }

  if (error || !signedUrl) {
    return (
      <div
        className={cn(
          "text-destructive flex h-full flex-col items-center justify-center gap-2 p-4 text-sm",
          className,
        )}
      >
        <AlertCircle size={16} />
        <p className="max-w-md text-center">
          {error ?? "Could not prepare preview."}
        </p>
      </div>
    );
  }

  const filename = basename(path);
  const fileType = fileTypeFromPath(path);
  return (
    <div className={cn("h-full w-full overflow-hidden bg-white", className)}>
      <DocViewer
        documents={[{ uri: signedUrl, fileType, fileName: filename }]}
        pluginRenderers={DocViewerRenderers}
        style={{ height: "100%", width: "100%" }}
        config={{
          header: { disableHeader: true, disableFileName: true },
        }}
      />
    </div>
  );
}
