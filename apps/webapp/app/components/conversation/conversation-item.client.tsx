import { EditorContent, useEditor } from "@tiptap/react";

import { useEffect, memo, useState } from "react";
import { cn } from "~/lib/utils";
import { extensionsForConversation } from "./editor-extensions";
import { skillExtension } from "../editor/skill-extension";
import {
  type ChatAddToolApproveResponseFunction,
  type ToolUIPart,
  type UIMessage,
} from "ai";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "../ui/collapsible";
import StaticLogo from "../logo/logo";
import { titleCase } from "~/utils";
import { Button } from "../ui";
import { ChevronsUpDown, LoaderCircle, TriangleAlert } from "lucide-react";
import { ApprovalComponent } from "./approval-component";

interface AIConversationItemProps {
  message: UIMessage;
  addToolApprovalResponse: ChatAddToolApproveResponseFunction;
}

function getMessage(message: string) {
  let finalMessage = message.replace("<final_response>", "");
  finalMessage = finalMessage.replace("</final_response>", "");
  finalMessage = finalMessage.replace("<question_response>", "");
  finalMessage = finalMessage.replace("</question_response>", "");

  return finalMessage;
}

const Tool = ({
  part,
  addToolApprovalResponse,
  isDisabled = false,
}: {
  part: ToolUIPart<any>;
  addToolApprovalResponse: ChatAddToolApproveResponseFunction;
  isDisabled?: boolean;
}) => {
  const needsApproval = part.state === "approval-requested";
  const [isOpen, setIsOpen] = useState(needsApproval);
  const textPart = part.output?.content ? part.output?.content[0]?.text : "";

  const handleApprove = () => {
    if (addToolApprovalResponse && part?.approval?.id && !isDisabled) {
      addToolApprovalResponse({ id: part?.approval?.id, approved: true });
      setIsOpen(false);
    }
  };

  const handleReject = () => {
    if (addToolApprovalResponse && part?.approval?.id && !isDisabled) {
      addToolApprovalResponse({ id: part?.approval?.id, approved: false });
      setIsOpen(false);
    }
  };

  useEffect(() => {
    if (needsApproval) {
      setIsOpen(needsApproval);
    }
  }, [needsApproval]);

  function getIcon() {
    if (
      part.state === "output-available" ||
      part.state === "approval-requested" ||
      part.state === "approval-responded"
    ) {
      return <StaticLogo size={18} className="rounded-sm" />;
    }

    if (part.state === "output-denied") {
      return <TriangleAlert size={18} className="rounded-dm" />;
    }

    return <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />;
  }

  return (
    <Collapsible
      open={isOpen}
      onOpenChange={setIsOpen}
      className={cn(
        "my-1 w-full rounded border-1 border-gray-300 px-2",
        isDisabled && "cursor-not-allowed opacity-50",
      )}
    >
      <CollapsibleTrigger asChild>
        <Button
          variant="link"
          full
          size="xl"
          className="flex justify-between gap-4 px-2 py-2"
          disabled={isDisabled}
        >
          <div className="flex items-center gap-2">
            {getIcon()}
            {titleCase(part.type.replace("tool-", "").replace(/_/g, " "))}
          </div>

          <ChevronsUpDown size={16} />
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent className="w-full">
        <div className="flex flex-col gap-2">
          {!isDisabled && (
            <div className="bg-grayAlpha-50 rounded p-2">
              <p className="text-muted-foreground text-sm"> Request </p>
              <p className="mt-2 font-mono text-[#BF4594]">
                {JSON.stringify(part.input, null, 2)}
              </p>
            </div>
          )}
          {needsApproval ? (
            isDisabled ? (
              <div className="rounded p-3 text-sm">
                Waiting for previous tool approval...
              </div>
            ) : (
              <ApprovalComponent
                onApprove={handleApprove}
                onReject={handleReject}
              />
            )
          ) : (
            <div className="bg-grayAlpha-50 mb-2 max-w-full rounded p-2">
              <p className="text-muted-foreground text-sm"> Response </p>
              <p className="mt-2 font-mono text-[#BF4594]">{textPart}</p>
            </div>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
};

const ConversationItemComponent = ({
  message,
  addToolApprovalResponse,
}: AIConversationItemProps) => {
  const isUser = message.role === "user" || false;
  const textPart = message.parts.find((part) => part.type === "text");
  const [showAllTools, setShowAllTools] = useState(false);

  const editor = useEditor({
    extensions: [...extensionsForConversation, skillExtension],
    editable: false,
    content: textPart ? getMessage(textPart.text) : "",
  });

  useEffect(() => {
    if (textPart) {
      editor?.commands.setContent(getMessage(textPart.text));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [message]);

  if (!message) {
    return null;
  }

  // Group consecutive tools together
  const groupedParts: Array<{ type: 'tool-group' | 'single'; parts: any[] }> = [];
  let currentToolGroup: any[] = [];

  message.parts.forEach((part, index) => {
    if (part.type.includes("tool-")) {
      currentToolGroup.push(part);
    } else {
      // If we have accumulated tools, add them as a group
      if (currentToolGroup.length > 0) {
        groupedParts.push({
          type: 'tool-group',
          parts: [...currentToolGroup],
        });
        currentToolGroup = [];
      }
      // Add the non-tool part
      groupedParts.push({
        type: 'single',
        parts: [part],
      });
    }
  });

  // Don't forget the last tool group if exists
  if (currentToolGroup.length > 0) {
    groupedParts.push({
      type: 'tool-group',
      parts: [...currentToolGroup],
    });
  }

  // Enhanced addToolApprovalResponse that auto-rejects subsequent tools
  const handleToolApproval = (params: { id: string; approved: boolean }) => {
    addToolApprovalResponse(params);

    // If rejected, auto-reject all subsequent tools that need approval
    if (!params.approved) {
      // Find all tools in the message
      const allTools = message.parts.filter((part: any) => part.type.includes("tool-"));
      const currentToolIndex = allTools.findIndex(
        (part: any) => part.approval?.id === params.id,
      );

      if (currentToolIndex !== -1) {
        // Reject all subsequent tools that need approval
        allTools.slice(currentToolIndex + 1).forEach((part: any) => {
          if (part.state === "approval-requested" && part.approval?.id) {
            setTimeout(() => {
              addToolApprovalResponse({
                id: part.approval.id,
                approved: false,
              });
            }, 100);
          }
        });
      }
    }
  };

  const getComponent = (part: any, isDisabled: boolean = false) => {
    if (part.type.includes("tool-")) {
      return (
        <Tool
          part={part as any}
          addToolApprovalResponse={handleToolApproval}
          isDisabled={isDisabled}
        />
      );
    }

    if (part.type.includes("text")) {
      return <EditorContent editor={editor} className="editor-container" />;
    }

    return null;
  };

  // Find the first pending approval tool globally
  const allTools = message.parts.filter((part: any) => part.type.includes("tool-"));
  const firstPendingApprovalIndex = allTools.findIndex(
    (part: any) => part.state === "approval-requested",
  );

  return (
    <div
      className={cn(
        "flex w-full gap-2 px-4 pb-2",
        isUser && "my-4 justify-end",
      )}
    >
      <div
        className={cn(
          "flex w-full flex-col",
          isUser && "bg-primary/20 max-w-[500px] rounded-md p-3",
        )}
      >
        {groupedParts.map((group, groupIndex) => {
          if (group.type === 'single') {
            // Render non-tool part
            return (
              <div key={`single-${groupIndex}`}>
                {getComponent(group.parts[0])}
              </div>
            );
          }

          // Handle tool group
          const toolGroup = group.parts;
          const shouldCollapse = toolGroup.length > 3;
          const visibleTools = shouldCollapse && !showAllTools
            ? toolGroup.slice(0, 2)
            : toolGroup;
          const hiddenCount = shouldCollapse ? toolGroup.length - 2 : 0;

          return (
            <div key={`group-${groupIndex}`}>
              {visibleTools.map((part, index) => {
                const globalToolIndex = allTools.indexOf(part);
                const isDisabled =
                  firstPendingApprovalIndex !== -1 &&
                  globalToolIndex > firstPendingApprovalIndex &&
                  (part as any).state === "approval-requested";

                return (
                  <div key={`tool-${groupIndex}-${index}`}>
                    {getComponent(part, isDisabled)}
                  </div>
                );
              })}

              {/* Show expand/collapse button for this group if needed */}
              {shouldCollapse && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowAllTools(!showAllTools)}
                  className="text-muted-foreground hover:text-foreground mt-2 self-start text-sm"
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
  );
};

// Memoize to prevent unnecessary re-renders
export const ConversationItem = memo(
  ConversationItemComponent,
  (prevProps, nextProps) => {
    // Only re-render if the conversation history ID or message changed
    return prevProps.message === nextProps.message;
  },
);
