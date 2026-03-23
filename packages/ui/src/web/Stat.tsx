import React from "react";
import { cn } from "./utils";

export interface StatProps {
  value: string | number;
  label: string;
  sublabel?: string;
  className?: string;
}

export function Stat({ value, label, sublabel, className }: StatProps) {
  return (
    <div className={cn("flex flex-col gap-0.5", className)}>
      <p className="text-3xl font-bold">{value}</p>
      <p className="text-sm font-medium">{label}</p>
      {sublabel && <p className="text-muted-foreground text-xs">{sublabel}</p>}
    </div>
  );
}
