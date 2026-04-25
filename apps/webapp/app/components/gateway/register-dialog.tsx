import { useState } from "react";
import { Plus } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "~/components/ui/dialog";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Textarea } from "~/components/ui/textarea";

interface Props {
  /** Optional custom trigger; defaults to a "+ New gateway" button. */
  trigger?: React.ReactNode;
  open?: boolean;
  onOpenChange?: (v: boolean) => void;
  onRegistered?: () => void;
}

/**
 * Self-contained Register Gateway dialog. Mirrors the flow that used to live
 * inline in `settings.workspace.gateway.tsx` so the sidebar's `+` button and
 * any future entry points can reuse it.
 */
export function RegisterGatewayDialog({
  trigger,
  open,
  onOpenChange,
  onRegistered,
}: Props) {
  const isControlled = typeof open === "boolean";
  const [internalOpen, setInternalOpen] = useState(false);
  const actualOpen = isControlled ? (open as boolean) : internalOpen;
  const setOpen = (v: boolean) => {
    if (!isControlled) setInternalOpen(v);
    onOpenChange?.(v);
  };

  const [baseUrl, setBaseUrl] = useState("");
  const [securityKey, setSecurityKey] = useState("");
  const [status, setStatus] = useState<"idle" | "submitting" | "error">(
    "idle",
  );
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setBaseUrl("");
    setSecurityKey("");
    setStatus("idle");
    setError(null);
  };

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus("submitting");
    setError(null);
    try {
      const res = await fetch("/api/v1/gateways", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          intent: "register",
          baseUrl,
          securityKey,
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? `Request failed (${res.status})`);
        setStatus("error");
        return;
      }
      reset();
      setOpen(false);
      onRegistered?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStatus("error");
    }
  }

  return (
    <Dialog
      open={actualOpen}
      onOpenChange={(v) => {
        setOpen(v);
        if (!v) reset();
      }}
    >
      {trigger === null ? null : trigger ? (
        <DialogTrigger asChild>{trigger}</DialogTrigger>
      ) : (
        <DialogTrigger asChild>
          <Button variant="secondary" className="gap-2">
            <Plus size={14} />
            New gateway
          </Button>
        </DialogTrigger>
      )}
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Register a gateway</DialogTitle>
        </DialogHeader>
        <p className="text-muted-foreground text-sm">
          Paste the <code>baseUrl</code> and <code>securityKey</code> printed
          by <code>corebrain gateway register</code> (or shown by the gateway
          container on first boot). The gateway's name is pulled from its
          manifest.
        </p>
        <form
          onSubmit={handleSubmit}
          id="register-gateway-form"
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
              placeholder="gwk_..."
              value={securityKey}
              onChange={(e) => setSecurityKey(e.target.value)}
              rows={2}
              required
              className="font-mono text-xs"
            />
          </div>
          {error ? <p className="text-destructive text-sm">{error}</p> : null}
        </form>
        <DialogFooter className="border-none py-2">
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            type="submit"
            variant="secondary"
            form="register-gateway-form"
            disabled={status === "submitting" || !baseUrl || !securityKey}
          >
            {status === "submitting" ? "Registering..." : "Register"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
