import { Button } from "../ui";
import { AlertTriangle, Check, CheckCircle, X, XCircle } from "lucide-react";

interface ApprovalComponentProps {
  onApprove: () => void;
  onReject: () => void;
}

export function ApprovalComponent({
  onApprove,
  onReject,
}: ApprovalComponentProps) {
  return (
    <div className="my-2 flex justify-end gap-2">
      <Button
        onClick={onReject}
        variant="ghost"
        className="flex items-center gap-2"
      >
        <X size={16} />
        Reject
      </Button>
      <Button
        onClick={onApprove}
        variant="secondary"
        className="flex items-center gap-2"
      >
        <Check size={16} />
        Approve
      </Button>
    </div>
  );
}
