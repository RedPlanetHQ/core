import { Code } from "lucide-react";

import { cn } from "../../lib/utils";

export interface TeamIconProps {
  name: string;
  color: string;
  className?: string;
  icon?: string;
}

export function TeamIcon({ name, color, className }: TeamIconProps) {
  return (
    <div
      className={cn(
        `flex h-4 w-4 items-center justify-center rounded text-black`,
        className,
      )}
      style={{ background: color }}
    >
      <div className="!h-4 !w-4 shrink-0" />
    </div>
  );
}

export function getTeamColor(name: string): string {
  // Generate a hash value for the input name
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }

  // Ensure hash value is within the range of colors array
  const index = Math.abs(hash) % 3;

  return `var(--team-color-${index + 1})`;
}
