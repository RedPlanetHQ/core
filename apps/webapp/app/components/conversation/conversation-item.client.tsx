import { EditorContent, useEditor } from "@tiptap/react";
import { useEffect, memo, useMemo, useState } from "react";
import { cn } from "~/lib/utils";
import { extensionsForConversation } from "./editor-extensions";
import { type UIMessage } from "ai";
import { Button } from "../ui";
import { SamAvatar } from "../ui/sam-avatar";
import {
  findFirstPendingApprovalIndex,
  findAllToolsDeep,
  isToolDisabled,
  mergeAgentParts,
  groupToolParts,
  type ConversationToolPart,
  type ExtendedPart,
} from "./conversation-utils";
import { Tool } from "./tool-item";

/**
 * Per-message sender attribution. `user` maps to the human; `agent` to
 * one of the workspace agents. When the agent's `appearance` is null we
 * render a neutral avatar so a legacy row without SamAvatar props still
 * displays something.
 */
export type ConversationItemSender =
  | { kind: "user"; name: string }
  | {
      kind: "agent";
      name: string;
      appearance: {
        eye?: string;
        eyeColor?: string;
        accentColor?: string;
      } | null;
    };

interface AIConversationItemProps {
  message: UIMessage;
  createdAt?: string | Date;
  /** Who authored this message. Rendered as an avatar + name row above
   *  the message body — Slack-style. Optional so legacy call sites keep
   *  compiling; when absent the header is omitted. */
  sender?: ConversationItemSender;
  integrationAccountMap?: Record<string, string>;
  integrationFrontendMap?: Record<string, string>;
  className?: string;
}

const ConversationItemComponent = ({
  message,
  createdAt,
  sender,
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

  // Pending-approval / ask_user rendering was removed alongside the
  // fire-and-forget migration. See services/agent/agents/core.ts for the
  // rationale. isUser is retained above only for potential future
  // per-role rendering; not currently branched on.
  void isUser;

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

  const getComponent = (part: ExtendedPart, isDisabled = false) => {
    const partType = (part as { type?: string }).type;

    if (typeof partType === "string" && partType.includes("tool-")) {
      return (
        <Tool
          part={part as unknown as ConversationToolPart}
          isDisabled={isDisabled}
          firstPendingApprovalIdx={firstPendingApprovalIdx}
          integrationAccountMap={integrationAccountMap}
          integrationFrontendMap={integrationFrontendMap}
        />
      );
    }

    if (typeof partType === "string" && partType.includes("text")) {
      return (
        <EditorContent
          editor={editor}
          className={cn("editor-container", "mt-1")}
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

  // Slack-style layout: every message left-aligned, with an avatar
  // column on the left and a header row (name • timestamp) above the
  // body. No bubble background — the vertical spacing carries the
  // grouping. Both user and agent messages share this shape so multi-
  // participant threads read cleanly.
  return (
    <div
      className={cn(
        "group/message flex w-full gap-3 px-5 py-2",
        className,
      )}
    >
      <div className="flex shrink-0 pt-0.5">
        {sender?.kind === "agent" && sender.appearance ? (
          <SamAvatar
            size={28}
            eye={sender.appearance.eye}
            eyeColor={sender.appearance.eyeColor}
          />
        ) : (
          <div
            className={cn(
              "flex h-7 w-7 items-center justify-center rounded-md text-xs font-medium",
              sender?.kind === "user"
                ? "bg-primary/20 text-primary"
                : "bg-muted text-muted-foreground",
            )}
            aria-hidden
          >
            {(sender?.name ?? "?").slice(0, 1).toUpperCase()}
          </div>
        )}
      </div>

      <div className="flex min-w-0 flex-1 flex-col">
        {sender && (
          <div className="flex items-baseline gap-2">
            <span className="text-foreground text-sm font-medium">
              {sender.name}
            </span>
            {formattedTime && (
              <span className="text-muted-foreground text-[10px] opacity-0 transition-opacity group-hover/message:opacity-100">
                {formattedTime}
              </span>
            )}
          </div>
        )}

        <div className="flex w-full min-w-0 flex-col">
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
        </div>
      </div>
    </div>
  );
};

// Memoize to prevent unnecessary re-renders
export const ConversationItem = memo(
  ConversationItemComponent,
  (prevProps, nextProps) => {
    return (
      prevProps.message === nextProps.message &&
      prevProps.sender?.name === nextProps.sender?.name
    );
  },
);
