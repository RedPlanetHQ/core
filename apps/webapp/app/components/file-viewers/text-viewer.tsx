import { cn } from "~/lib/utils";
import type { ViewerComponentProps } from "./types";

/**
 * Fallback viewer for plain-text files (`.txt`, `.log`, dotfiles
 * without a known extension). Wraps long lines so logs stay readable.
 */
export function TextViewer({ content, className }: ViewerComponentProps) {
  if (!content) return null;
  return (
    <pre
      className={cn(
        "bg-background-2 m-0 overflow-auto whitespace-pre-wrap break-words p-4 font-mono text-xs leading-5",
        className,
      )}
    >
      {content.text}
    </pre>
  );
}
