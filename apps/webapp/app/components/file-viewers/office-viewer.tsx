import { useEffect, useState } from "react";
import DocViewer, { DocViewerRenderers } from "@cyntler/react-doc-viewer";
import {
  AlertCircle,
  Download,
  ExternalLink,
  Loader2,
  ShieldAlert,
} from "lucide-react";
import { Button, buttonVariants } from "~/components/ui";
import { cn } from "~/lib/utils";
import type { ViewerComponentProps } from "./types";

/**
 * Office document viewer (PPTX / DOCX / XLSX) powered by
 * @cyntler/react-doc-viewer's MSDocRenderer, which embeds the file
 * via the Microsoft Office Online Viewer.
 *
 * Privacy gate: Microsoft Office Online is a hosted preview — their
 * servers fetch the file bytes from a short-lived (5 min) signed URL
 * during render. To keep that explicit, we DON'T mint the signed URL
 * on mount. The user sees a consent card first with two choices:
 *   - Allow:    mint the signed URL and embed the Office Online iframe
 *   - Download: hit the session-gated /fs/download route directly,
 *               nothing touches Microsoft
 *
 * Asked every time. No session memory yet — when "remember this" is
 * needed, do it as a workspace setting, not browser-local state.
 *
 * Signed URL flow: POST /fs/signed-url (auth-gated) mints an HMAC
 * token scoped to (workspaceId, gatewayId, path) with a 5-minute
 * expiry. The matching public route /api/v1/fs/signed/:token/:filename
 * streams the bytes inline so Microsoft's iframe can fetch them.
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

export function OfficeViewer({
  gatewayId,
  path,
  className,
}: ViewerComponentProps) {
  const [signedUrl, setSignedUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Consent is asked every time. No session memory — the user picks
  // Allow or Download on each open. Until "Allow" is clicked we don't
  // mint a signed URL, so Microsoft never gets a pointer to the file.
  const [consented, setConsented] = useState(false);

  const filename = basename(path);
  const downloadHref = `/api/v1/gateways/${gatewayId}/fs/download?path=${encodeURIComponent(path)}`;

  useEffect(() => {
    if (!consented) return;
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
  }, [gatewayId, path, consented]);

  // Reset consent whenever the file changes — every open re-prompts.
  useEffect(() => {
    setConsented(false);
    setSignedUrl(null);
    setError(null);
  }, [gatewayId, path]);

  if (!consented) {
    return (
      <div
        className={cn(
          "flex h-full flex-col items-center justify-center gap-3 p-6 text-center",
          className,
        )}
      >
        <ShieldAlert size={28} className="text-muted-foreground" />
        <div className="max-w-md space-y-1">
          <p className="text-foreground font-medium">
            Preview sends this file to Microsoft
          </p>
          <p className="text-muted-foreground text-sm leading-relaxed">
            To render {filename} we hand a short-lived (5 min) signed URL to
            Microsoft Office Online. Their servers fetch the bytes to display
            the preview. If you'd rather not, download the file instead.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button onClick={() => setConsented(true)}>
            <ExternalLink size={14} className="mr-1.5" />
            Allow
          </Button>
          {/* Plain anchor styled with buttonVariants — our Button always
              emits a leading slot ({isLoading ? <Loader/> : <></>}) which
              violates Slot's React.Children.only when used with asChild. */}
          <a
            href={downloadHref}
            download={filename}
            className={buttonVariants({ variant: "secondary" })}
          >
            <Download size={14} className="mr-1.5" />
            Download
          </a>
        </div>
      </div>
    );
  }

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

  const fileType = fileTypeFromPath(path);
  return (
    <div
      className={cn(
        "office-viewer-host h-full w-full overflow-hidden bg-white",
        className,
      )}
    >
      {/* The library doesn't cascade its inline `style={{ height: '100%' }}`
          down to the iframe — its inner wrappers default to a small fixed
          height. Force the full chain to fill the host. */}
      <style>{`
        .office-viewer-host #react-doc-viewer,
        .office-viewer-host #proxy-renderer,
        .office-viewer-host #msdoc-renderer {
          height: 100% !important;
          width: 100% !important;
        }
        .office-viewer-host #msdoc-iframe {
          height: 100% !important;
          width: 100% !important;
          border: 0;
        }
      `}</style>
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
