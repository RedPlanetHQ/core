import React from "react";
import { cn } from "./utils";

export interface ListItem {
  label: string;
  value?: string;
  sublabel?: string;
  icon?: React.ReactNode;
}

export interface ListProps {
  title?: string;
  items: ListItem[];
  emptyText?: string;
  className?: string;
}

export function List({ title, items, emptyText = "No items", className }: ListProps) {
  return (
    <div className={cn("flex flex-col gap-0.5", className)}>
      {title && (
        <p className="text-muted-foreground mb-2 text-xs font-medium uppercase tracking-wide">
          {title}
        </p>
      )}
      {items.length === 0 ? (
        <p className="text-muted-foreground text-sm">{emptyText}</p>
      ) : (
        items.map((item, i) => (
          <div
            key={i}
            className="hover:bg-muted/50 flex items-center justify-between gap-2 rounded px-1 py-1.5"
          >
            <div className="flex min-w-0 items-center gap-2">
              {item.icon && (
                <span className="text-muted-foreground shrink-0">{item.icon}</span>
              )}
              <div className="min-w-0">
                <p className="truncate text-sm">{item.label}</p>
                {item.sublabel && (
                  <p className="text-muted-foreground truncate text-xs">{item.sublabel}</p>
                )}
              </div>
            </div>
            {item.value && (
              <span className="text-muted-foreground shrink-0 text-xs">{item.value}</span>
            )}
          </div>
        ))
      )}
    </div>
  );
}
