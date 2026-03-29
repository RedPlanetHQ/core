import { useEffect, useState } from "react";
import { cn } from "~/lib/utils";
import { Button } from "../ui";
import { Check, LoaderCircle, X } from "lucide-react";

interface ApprovalComponentProps {
  onApprove: () => void;
  onReject: () => void;
  disabled?: boolean;
  isChatBusy?: boolean;
}

export function ApprovalComponent({
  onApprove,
  onReject,
  disabled = false,
  isChatBusy = false,
}: ApprovalComponentProps) {
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (submitting && !isChatBusy) {
      setSubmitting(false);
    }
  }, [isChatBusy]);

  const handleApprove = () => {
    if (disabled) return;
    setSubmitting(true);
    onApprove();
  };

  if (submitting && isChatBusy) {
    return (
      <div className="text-muted-foreground my-2 flex items-center justify-end gap-2 text-sm">
        <LoaderCircle className="h-4 w-4 animate-spin" />
        <span>Running...</span>
      </div>
    );
  }

  return (
    <div className={cn("my-2 flex justify-end gap-2", disabled && "opacity-50")}>
      <Button
        onClick={disabled ? undefined : onReject}
        disabled={disabled}
        variant="ghost"
        className="flex items-center gap-2"
      >
        <X size={16} />
        Reject
      </Button>
      <Button
        onClick={disabled ? undefined : handleApprove}
        disabled={disabled}
        variant="secondary"
        className="flex items-center gap-2"
      >
        <Check size={16} />
        Approve
      </Button>
    </div>
  );
}
