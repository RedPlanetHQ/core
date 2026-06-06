/**
 * Browser-side helper for the gateway file-download flow. Fetches the
 * file from the chunked `/fs/download` route, builds a Blob URL, and
 * triggers a download via an ephemeral anchor — so the caller can
 * `await` completion and know when to clear loading state.
 *
 * Shared by `files-pane.tsx` (per-row hover button) and the chat
 * widget (`file-widget.tsx`).
 */
export async function triggerGatewayDownload(
  gatewayId: string,
  path: string,
  suggestedName: string,
): Promise<void> {
  const res = await fetch(
    `/api/v1/gateways/${gatewayId}/fs/download?path=${encodeURIComponent(path)}`,
  );
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(text.trim() || `Download failed (${res.status})`);
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement("a");
    a.href = url;
    a.download = suggestedName;
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    URL.revokeObjectURL(url);
  }
}
