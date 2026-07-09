import { EditorContent, useEditor } from "@tiptap/react";
import { useEffect, memo, useMemo, useState } from "react";
import { cn } from "~/lib/utils";
import { extensionsForConversation } from "./editor-extensions";
import { type ChatAddToolApproveResponseFunction, type UIMessage } from "ai";
import { Button } from "../ui";
import {
  findFirstPendingApprovalIndex,
  findAllToolsDeep,
  findPendingApprovals,
  isToolDisabled,
  mergeAgentParts,
  groupToolParts,
  type ConversationToolPart,
  type ExtendedPart,
} from "./conversation-utils";
import { Tool } from "./tool-item";
import { ToolApprovalPanel } from "./tool-approval-panel.client";

interface AIConversationItemProps {
  message: UIMessage;
  createdAt?: string | Date;
  addToolApprovalResponse: ChatAddToolApproveResponseFunction;
  setToolArgOverride: (
    toolCallId: string,
    args: Record<string, unknown>,
  ) => void;
  isChatBusy?: boolean;
  integrationAccountMap?: Record<string, string>;
  integrationFrontendMap?: Record<string, string>;
  className?: string;
}

const ConversationItemComponent = ({
  message,
  createdAt,
  addToolApprovalResponse,
  setToolArgOverride,
  isChatBusy = false,
  integrationAccountMap = {},
  integrationFrontendMap = {},
  className,
}: AIConversationItemProps) => {
  const isUser = message?.role === "user" || false;
  const combinedText = useMemo(
    () =>
      message
        ? message.parts
            .filter((part: any) => part.type === "text" && part.text)
            .map((p: any) => p.text)
            .join("")
        : "",
    [message],
  );
  const [showAllTools, setShowAllTools] = useState(false);
  const formattedTime = createdAt
    ? new Date(createdAt).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      })
    : null;

  const editor = useEditor({
    extensions: [...extensionsForConversation],
    editable: false,
    content: combinedText ? combinedText : "",
  });

  // Push new content only when the extracted text actually changes. During a
  // sub-agent's tool-call storm, `message` identity flips on every stream
  // chunk while combinedText is unchanged — depending on `message` here would
  // reflow the editor hundreds of times a second and lock up the main thread.
  useEffect(() => {
    if (combinedText) {
      editor?.commands.setContent(combinedText);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [combinedText]);

  // Every derived value below walks the (potentially deep) parts tree once.
  // Memoize on `message` so unrelated state changes (showAllTools toggle,
  // isChatBusy flip) don't re-run the walks. During streaming the message
  // reference does churn per tick, but throttling `useChat` upstream keeps
  // the cost bounded.
  const mergedParts = useMemo(
    () => (message ? mergeAgentParts(message.parts) : []),
    [message],
  );

  const groupedParts = useMemo(
    () => groupToolParts(mergedParts),
    [mergedParts],
  );

  // Pending approvals from merged parts (so nested tools inside take_action are visible)
  const pendingApprovals = useMemo(
    () => (isUser ? [] : findPendingApprovals(mergedParts)),
    [isUser, mergedParts],
  );

  // Use mergedParts so data-tool-agent nested tools are included in the flat list
  const allToolsFlat = useMemo(
    () => findAllToolsDeep(mergedParts),
    [mergedParts],
  );
  const firstPendingApprovalIdx = useMemo(
    () => findFirstPendingApprovalIndex(allToolsFlat),
    [allToolsFlat],
  );

  if (!message) {
    return null;
  }

  // Pass approval responses straight through — cascade-reject is handled inside ToolApprovalPanel.
  const handleToolApproval = (params: { id: string; approved: boolean }) => {
    addToolApprovalResponse(params);
  };

  const getComponent = (part: ExtendedPart, isDisabled = false) => {
    const partType = (part as { type?: string }).type;

    if (typeof partType === "string" && partType.includes("tool-")) {
      return (
        <Tool
          part={part as unknown as ConversationToolPart}
          addToolApprovalResponse={handleToolApproval}
          isDisabled={isDisabled}
          firstPendingApprovalIdx={firstPendingApprovalIdx}
          integrationAccountMap={integrationAccountMap}
          integrationFrontendMap={integrationFrontendMap}
          setToolArgOverride={setToolArgOverride}
        />
      );
    }

    if (typeof partType === "string" && partType.includes("text")) {
      return (
        <EditorContent
          editor={editor}
          className={cn("editor-container", !isUser && "mt-2")}
          defaultValue={
            "content" in part
              ? String((part as { content?: unknown }).content ?? "")
              : ""
          }
        />
      );
    }

    if (
      partType === "file" &&
      typeof (part as { mediaType?: string }).mediaType === "string"
    ) {
      const filePart = part as {
        url?: string;
        filename?: string;
        mediaType: string;
      };
      const isImage = filePart.mediaType.startsWith("image/");
      const label =
        filePart.filename ??
        (isImage ? "image" : filePart.mediaType || "attachment");
      return (
        <a
          href={filePart.url}
          target="_blank"
          rel="noopener noreferrer"
          className="bg-background-2 border-border mt-2 inline-flex max-w-[240px] items-center gap-2 rounded-md border px-2 py-1 text-xs hover:underline"
          title={label}
        >
          {isImage && filePart.url ? (
            <img
              src={filePart.url}
              alt={label}
              className="h-6 w-6 shrink-0 rounded object-cover"
            />
          ) : (
            <>
              <span className="shrink-0">📎</span>
              <span className="truncate">{label}</span>
            </>
          )}
        </a>
      );
    }

    return null;
  };

  return (
    <div
      className={cn(
        "group/message flex w-full gap-2 px-5 pb-2",
        isUser && "my-4 justify-end",
        className,
      )}
    >
      <div className={cn("flex w-full flex-col", isUser && "w-fit items-end")}>
        <div
          className={cn(
            "flex w-full flex-col",
            isUser && "bg-grayAlpha-100 rounded-md p-2",
          )}
        >
          {groupedParts.map((group, groupIndex) => {
            if (group.type === "single") {
              return (
                <div key={`single-${groupIndex}`}>
                  {getComponent(group.parts[0])}
                </div>
              );
            }

            const toolGroup = group.parts;
            const shouldCollapse = toolGroup.length > 3;
            const visibleTools =
              shouldCollapse && !showAllTools
                ? toolGroup.slice(0, 2)
                : toolGroup;
            const hiddenCount = shouldCollapse ? toolGroup.length - 2 : 0;

            return (
              <div key={`group-${groupIndex}`}>
                {visibleTools.map((part, index) => {
                  const disabled = isToolDisabled(
                    part as unknown as ConversationToolPart,
                    allToolsFlat,
                    firstPendingApprovalIdx,
                  );
                  return (
                    <div key={`tool-${groupIndex}-${index}`}>
                      {getComponent(part, disabled)}
                    </div>
                  );
                })}

                {shouldCollapse && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setShowAllTools(!showAllTools)}
                    className="text-muted-foreground hover:text-foreground self-start text-sm"
                  >
                    {showAllTools
                      ? "Show less"
                      : `Show ${hiddenCount} more tool${hiddenCount > 1 ? "s" : ""}...`}
                  </Button>
                )}
              </div>
            );
          })}

          {pendingApprovals.length > 0 && (
            <ToolApprovalPanel
              pendingApprovals={pendingApprovals}
              addToolApprovalResponse={handleToolApproval}
              isChatBusy={isChatBusy}
              integrationAccountMap={integrationAccountMap}
              integrationFrontendMap={integrationFrontendMap}
              setToolArgOverride={setToolArgOverride}
            />
          )}
        </div>

        {formattedTime && (
          <div
            className={cn(
              "text-muted-foreground/70 pt-1 text-[10px] opacity-0 transition-opacity group-hover/message:opacity-100",
              isUser ? "self-end" : "self-start",
            )}
          >
            {formattedTime}
          </div>
        )}
      </div>
    </div>
  );
};

// Memoize to prevent unnecessary re-renders
export const ConversationItem = memo(
  ConversationItemComponent,
  (prevProps, nextProps) => {
    return prevProps.message === nextProps.message;
  },
);
