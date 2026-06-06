import { cn } from "~/lib/utils";
import type { ViewerComponentProps } from "./types";

/**
 * Plain-text code viewer with gutter line numbers. No syntax
 * highlighting in v1 — a follow-up can drop in shiki/prism without
 * touching the registry. Tabs are kept as-is; consumers control width
 * with a `tab-size` CSS rule if desired.
 */
export function CodeViewer({ content, className }: ViewerComponentProps) {
  if (!content) return null;
  const lines = content.text.split("\n");
  // Drop a trailing empty line introduced by a final "\n" so the
  // gutter doesn't show an empty extra row.
  if (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();
  const gutterWidth = `${Math.max(2, String(lines.length).length)}ch`;

  return (
    <pre
      className={cn(
        "bg-background-2 m-0 overflow-auto p-0 font-mono text-xs leading-5",
        className,
      )}
    >
      <code className="block">
        {lines.map((line, i) => (
          <div key={i} className="flex">
            <span
              className="text-muted-foreground/70 sticky left-0 inline-block shrink-0 select-none border-r px-2 py-0 text-right"
              style={{ width: `calc(${gutterWidth} + 1rem)` }}
            >
              {i + 1}
            </span>
            <span className="whitespace-pre px-3">{line || " "}</span>
          </div>
        ))}
      </code>
    </pre>
  );
}
