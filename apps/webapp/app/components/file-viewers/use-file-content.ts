import { useEffect, useState } from "react";
import type { FileContent } from "./types";

interface ReadResponse {
  read?: FileContent;
  error?: string;
}

interface UseFileContentResult {
  content: FileContent | null;
  loading: boolean;
  error: string | null;
  reload: () => void;
}

/**
 * Fetches a file's contents from the gateway via the `/fs/read`
 * route. Re-runs when `gatewayId` or `path` changes; manual `reload`
 * is available too. Exposed as a hook so any viewer host can reuse
 * the same loading/error semantics.
 */
export function useFileContent(
  gatewayId: string,
  path: string,
  maxBytes?: number,
): UseFileContentResult {
  const [content, setContent] = useState<FileContent | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setContent(null);

    fetch(`/api/v1/gateways/${gatewayId}/fs/read`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path, ...(maxBytes ? { maxBytes } : {}) }),
    })
      .then(async (r) => {
        const body = (await r.json().catch(() => ({}))) as ReadResponse;
        if (cancelled) return;
        if (!r.ok || !body.read) {
          setError(body.error ?? `Failed (${r.status})`);
          return;
        }
        setContent(body.read);
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
  }, [gatewayId, path, maxBytes, tick]);

  return {
    content,
    loading,
    error,
    reload: () => setTick((n) => n + 1),
  };
}
