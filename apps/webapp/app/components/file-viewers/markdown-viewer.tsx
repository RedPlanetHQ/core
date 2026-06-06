import { StyledMarkdown } from "~/components/common/styled-markdown";
import { cn } from "~/lib/utils";
import type { ViewerComponentProps } from "./types";

export function MarkdownViewer({ content, className }: ViewerComponentProps) {
  if (!content) return null;
  return (
    <div className={cn("px-6 py-4 text-sm", className)}>
      <StyledMarkdown>{content.text}</StyledMarkdown>
    </div>
  );
}
