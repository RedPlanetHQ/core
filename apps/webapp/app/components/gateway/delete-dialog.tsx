import { useEffect, useState } from "react";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "~/components/ui/alert-dialog";
import { Button } from "~/components/ui/button";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  gatewayId: string;
  gatewayName: string;
  onDeleted?: () => void;
}

export function DeleteGatewayDialog({
  open,
  onOpenChange,
  gatewayId,
  gatewayName,
  onDeleted,
}: Props) {
  const [status, setStatus] = useState<"idle" | "submitting" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setStatus("idle");
      setError(null);
    }
  }, [open]);

  async function handleConfirm() {
    setStatus("submitting");
    setError(null);
    try {
      const res = await fetch(`/api/v1/gateways/${gatewayId}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? `Request failed (${res.status})`);
        setStatus("error");
        return;
      }
      onOpenChange(false);
      onDeleted?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStatus("error");
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete gateway</AlertDialogTitle>
          <AlertDialogDescription>
            This will permanently remove <span className="font-medium">{gatewayName}</span>{" "}
            and any coding sessions tied to it. This action cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {error ? <p className="text-destructive text-sm">{error}</p> : null}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={status === "submitting"}>
            Cancel
          </AlertDialogCancel>
          <Button
            variant="destructive"
            onClick={handleConfirm}
            disabled={status === "submitting"}
          >
            {status === "submitting" ? "Deleting..." : "Delete"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
