import React from "react";
import { cn } from "./utils";

export interface TextBlockProps {
  title?: string;
  content: string;
  className?: string;
}

export function TextBlock({ title, content, className }: TextBlockProps) {
  return (
    <div className={cn("flex flex-col gap-2", className)}>
      {title && (
        <p className="text-muted-foreground text-xs font-medium uppercase tracking-wide">
          {title}
        </p>
      )}
      <p className="text-sm leading-relaxed whitespace-pre-wrap">{content}</p>
    </div>
  );
}
