import { useState } from "react";
import { Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  gatewayId: string;
  onAdded?: () => void;
}

export function AddFolderDialog({
  open,
  onOpenChange,
  gatewayId,
  onAdded,
}: Props) {
  const [path, setPath] = useState("");
  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setPath("");
    setName("");
    setError(null);
  };

  const handleSubmit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/gateways/${gatewayId}/folders`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "local",
          path: path.trim(),
          name: name.trim() || undefined,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? `Failed (${res.status})`);
      onAdded?.();
      reset();
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  const canSubmit = !submitting && path.trim().length > 0;

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) reset();
        onOpenChange(v);
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add folder</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-3 py-2">
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium">
              Absolute path on the gateway
            </label>
            <Input
              placeholder="/Users/you/code/my-project"
              value={path}
              onChange={(e) => setPath(e.target.value)}
              className="font-mono text-sm"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium">
              Name <span className="text-muted-foreground">(optional)</span>
            </label>
            <Input
              placeholder="defaults to last segment of path"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          {error ? <p className="text-destructive text-xs">{error}</p> : null}
        </div>

        <DialogFooter className="border-none p-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="secondary"
            disabled={!canSubmit}
            onClick={handleSubmit}
          >
            {submitting ? (
              <>
                <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                Adding…
              </>
            ) : (
              "Add folder"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
