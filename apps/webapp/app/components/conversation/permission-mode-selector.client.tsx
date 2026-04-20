import { ShieldAlert, ShieldCheck } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select";

export type PermissionMode = "default" | "full";

interface PermissionModeSelectorProps {
  value: PermissionMode;
  onChange: (mode: PermissionMode) => void;
  disabled?: boolean;
}

export function PermissionModeSelector({
  value,
  onChange,
  disabled,
}: PermissionModeSelectorProps) {
  return (
    <Select
      value={value}
      onValueChange={(v) => onChange(v as PermissionMode)}
      disabled={disabled}
    >
      <SelectTrigger className="text-smshadow-none h-8 w-auto min-w-[120px] border-0 bg-transparent focus:ring-0">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="default">
          <span className="flex items-center gap-1.5">
            <ShieldAlert size={14} />
            <span>Default</span>
          </span>
        </SelectItem>
        <SelectItem value="full">
          <span className="flex items-center gap-1.5 text-sm">
            <ShieldCheck size={14} />
            <span>Full access</span>
          </span>
        </SelectItem>
      </SelectContent>
    </Select>
  );
}
