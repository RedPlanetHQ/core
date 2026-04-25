import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Textarea } from "~/components/ui/textarea";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  gatewayId: string;
  currentBaseUrl: string;
  onSaved?: () => void;
}

/**
 * Edit a registered gateway's connection details. URL pre-fills with the
 * current value; the security key field is empty and only sent when the user
 * actually types a new one (so opening the dialog and saving without touching
 * the key won't rotate it).
 */
export function EditGatewayDialog({
  open,
  onOpenChange,
  gatewayId,
  currentBaseUrl,
  onSaved,
}: Props) {
  const [baseUrl, setBaseUrl] = useState(currentBaseUrl);
  const [securityKey, setSecurityKey] = useState("");
  const [status, setStatus] = useState<"idle" | "submitting" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setBaseUrl(currentBaseUrl);
      setSecurityKey("");
      setStatus("idle");
      setError(null);
    }
  }, [open, currentBaseUrl]);

  const urlChanged = baseUrl.trim() !== "" && baseUrl.trim() !== currentBaseUrl;
  const keyChanged = securityKey.trim() !== "";
  const dirty = urlChanged || keyChanged;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!dirty) return;
    setStatus("submitting");
    setError(null);
    try {
      const res = await fetch(`/api/v1/gateways/${gatewayId}/update`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...(urlChanged ? { baseUrl: baseUrl.trim() } : {}),
          ...(keyChanged ? { securityKey: securityKey.trim() } : {}),
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? `Request failed (${res.status})`);
        setStatus("error");
        return;
      }
      onOpenChange(false);
      onSaved?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStatus("error");
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Edit gateway connection</DialogTitle>
        </DialogHeader>
        <p className="text-muted-foreground text-sm">
          Update the URL where this gateway daemon is reachable and/or rotate
          its security key. We verify the new values against the daemon before
          saving.
        </p>
        <form
          onSubmit={handleSubmit}
          id="edit-gateway-form"
          className="flex flex-col gap-3 py-2"
        >
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium">Base URL</label>
            <Input
              placeholder="https://your-gateway.example.com"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              type="url"
              required
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium">Security key</label>
            <Textarea
              placeholder="Leave blank to keep the existing key"
              value={securityKey}
              onChange={(e) => setSecurityKey(e.target.value)}
              rows={2}
              className="font-mono text-xs"
            />
          </div>
          {error ? <p className="text-destructive text-sm">{error}</p> : null}
        </form>
        <DialogFooter className="border-none py-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            type="submit"
            variant="secondary"
            form="edit-gateway-form"
            disabled={status === "submitting" || !dirty}
          >
            {status === "submitting" ? "Saving..." : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
