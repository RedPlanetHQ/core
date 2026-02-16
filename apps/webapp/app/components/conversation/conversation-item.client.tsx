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
import { Button } from "../ui";
import { ArrowDown, ArrowRight, ChevronDown, ChevronRight, LoaderCircle, TriangleAlert } from "lucide-react";
import { ApprovalComponent } from "./approval-component";
import { findAllToolsDeep, findFirstPendingApprovalIndex, isToolDisabled, hasNeedsApprovalDeep, getToolDisplayName } from "./conversation-utils";

interface AIConversationItemProps {
  message: UIMessage;
  addToolApprovalResponse: ChatAddToolApproveResponseFunction;
}

// Helper to get nested parts from output (checks both .parts and .content)
const getNestedPartsFromOutput = (output: any): any[] => {
  if (!output) return [];
  // Check output.parts first (sub-agent response structure)
  if (output.parts && Array.isArray(output.parts)) {
    return output.parts;
  }
  // Fallback to output.content
  if (output.content && Array.isArray(output.content)) {
    return output.content;
  }
  return [];
};

const Tool = ({
  part,
  addToolApprovalResponse,
  isDisabled = false,
  allToolsFlat = [],
  firstPendingApprovalIdx = -1,
  isNested = false,
}: {
  part: ToolUIPart<any>;
  addToolApprovalResponse: ChatAddToolApproveResponseFunction;
  isDisabled?: boolean;
  allToolsFlat?: any[];
  firstPendingApprovalIdx?: number;
  isNested?: boolean;
}) => {
  const needsApproval = part.state === "approval-requested";

  // Get all nested parts from output (handles both .parts and .content)
  const allNestedParts = getNestedPartsFromOutput((part as any).output);

  // Filter to get only tool parts
  const nestedToolParts = allNestedParts.filter(
    (item: any) => item.type?.includes("tool-")
  );
  const hasNestedTools = nestedToolParts.length > 0;

  // Check if any nested tool (at any depth) needs approval (to auto-open)
  const hasNestedApproval = hasNestedTools && hasNeedsApprovalDeep(nestedToolParts);

  const [isOpen, setIsOpen] = useState(needsApproval || hasNestedApproval);

  // Extract text parts from output (non-tool content)
  const textParts = allNestedParts.filter(
    (item: any) => !item.type?.includes("tool-") && (item.text || item.type === "text")
  );
  const textPart = textParts.map((t: any) => t.text).filter(Boolean).join("\n");

  const handleApprove = () => {
    console.log("asdfasdf")
    if (addToolApprovalResponse && (part as any)?.approval?.id && !isDisabled) {
      addToolApprovalResponse({ id: (part as any)?.approval?.id, approved: true });
      setIsOpen(false);
    }
  };

  const handleReject = () => {

    console.log("reasdfasdf")

    if (addToolApprovalResponse && (part as any)?.approval?.id && !isDisabled) {
      addToolApprovalResponse({ id: (part as any)?.approval?.id, approved: false });
      setIsOpen(false);
    }
  };

  useEffect(() => {
    if (needsApproval || hasNestedApproval) {
      setIsOpen(true);
    }
  }, [needsApproval, hasNestedApproval]);

  function getIcon() {
    if (
      part.state === "output-available" ||
      part.state === "approval-requested" ||
      part.state === "approval-responded"
    ) {
      return <StaticLogo size={18} className="rounded-sm" />;
    }

    if (part.state === "output-denied") {
      return <TriangleAlert size={18} className="rounded-sm" />;
    }

    return <LoaderCircle className="h-4 w-4 animate-spin" />;
  }

  // Get the display name for this tool
  const displayName = getToolDisplayName(part.type);

  // Render leaf tool (no nested tools) - compact output
  const renderLeafContent = () => {
    if (needsApproval) {
      if (isDisabled) {
        return (
          <div className="text-muted-foreground py-1 text-sm">
            Waiting for previous tool approval...
          </div>
        );
      }
      return (
        <ApprovalComponent
          onApprove={handleApprove}
          onReject={handleReject}
        />
      );
    }

    // Show JSON output for leaf tools
    const output = (part as any).output;
    const outputContent = output?.content || output;

    return (
      <div className="py-1">
        <p className="text-muted-foreground mb-1 text-xs font-medium">Result</p>
        <pre className="bg-grayAlpha-50 max-h-[200px] overflow-auto rounded p-2 font-mono text-xs text-[#BF4594]">
          {typeof outputContent === "string"
            ? outputContent
            : JSON.stringify(outputContent, null, 2)}
        </pre>
      </div>
    );
  };

  // Render nested tools (parent node)
  const renderNestedContent = () => {
    return (
      <div className="mt-1">
        {nestedToolParts.map((nestedPart: any, idx: number) => {
          const nestedDisabled = isToolDisabled(nestedPart, allToolsFlat, firstPendingApprovalIdx);
          return (
            <Tool
              key={`nested-${idx}`}
              part={nestedPart}
              addToolApprovalResponse={addToolApprovalResponse}
              isDisabled={nestedDisabled}
              allToolsFlat={allToolsFlat}
              firstPendingApprovalIdx={firstPendingApprovalIdx}
              isNested={true}
            />
          );
        })}
        {textPart && (
          <div className="py-1">
            <p className="text-muted-foreground mb-1 text-xs font-medium">Response</p>
            <p className="font-mono text-xs text-[#BF4594]">{textPart}</p>
          </div>
        )}
      </div>
    );
  };

  return (
    <Collapsible
      open={isOpen}
      onOpenChange={setIsOpen}
      className={cn(
        "w-full",
        isNested && "ml-4 border-l-2 border-gray-200 pl-3",
        !isNested && "my-1",
        isDisabled && "cursor-not-allowed opacity-50",
      )}
    >
      <CollapsibleTrigger asChild>
        <button
          className={cn(
            "flex w-full items-center gap-2 py-1 text-left hover:cursor-pointer",
            isDisabled && "cursor-not-allowed",
          )}
          disabled={isDisabled}
        >
          {getIcon()}
          <span >{displayName}</span>
          <span className="text-muted-foreground">{isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</span>
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent className={cn("w-full", isNested && "pl-6")}>
        {hasNestedTools ? renderNestedContent() : renderLeafContent()}
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

  console.log(message)
  const editor = useEditor({
    extensions: [...extensionsForConversation, skillExtension],
    editable: false,
    content: textPart ? textPart.text : "",
  });

  useEffect(() => {
    if (textPart) {
      editor?.commands.setContent(textPart.text);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [message]);

  if (!message) {
    return null;
  }

  // Group consecutive tools together
  const groupedParts: Array<{ type: "tool-group" | "single"; parts: any[] }> =
    [];
  let currentToolGroup: any[] = [];

  message.parts.forEach((part, index) => {
    if (part.type.includes("tool-")) {
      currentToolGroup.push(part);
    } else {
      // If we have accumulated tools, add them as a group
      if (currentToolGroup.length > 0) {
        groupedParts.push({
          type: "tool-group",
          parts: [...currentToolGroup],
        });
        currentToolGroup = [];
      }
      // Add the non-tool part
      groupedParts.push({
        type: "single",
        parts: [part],
      });
    }
  });

  // Don't forget the last tool group if exists
  if (currentToolGroup.length > 0) {
    groupedParts.push({
      type: "tool-group",
      parts: [...currentToolGroup],
    });
  }

  // Enhanced addToolApprovalResponse that auto-rejects subsequent tools (including nested)
  const handleToolApproval = (params: { id: string; approved: boolean }) => {
    addToolApprovalResponse(params);

    console.log(params)
    // If rejected, auto-reject all subsequent tools that need approval
    if (!params.approved) {
      // Find all tools in the message (including nested sub-agents)
      const allTools = findAllToolsDeep(message.parts);
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
                reason: "don't call this"
              });
            }, 100);
          }
        });
      }
    }
  };

  // Find the first pending approval tool globally (including nested sub-agents)
  const allToolsFlat = findAllToolsDeep(message.parts);
  const firstPendingApprovalIdx = findFirstPendingApprovalIndex(message.parts);

  const getComponent = (part: any, isDisabled: boolean = false) => {
    if (part.type.includes("tool-")) {
      return (
        <Tool
          part={part as any}
          addToolApprovalResponse={handleToolApproval}
          isDisabled={isDisabled}
          allToolsFlat={allToolsFlat}
          firstPendingApprovalIdx={firstPendingApprovalIdx}
        />
      );
    }

    if (part.type.includes("text")) {
      return <EditorContent editor={editor} className="editor-container" />;
    }

    return null;
  };

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
          isUser && "bg-primary/20 w-fit max-w-[500px] rounded-md p-3",
        )}
      >
        {groupedParts.map((group, groupIndex) => {
          if (group.type === "single") {
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
          const visibleTools =
            shouldCollapse && !showAllTools ? toolGroup.slice(0, 2) : toolGroup;
          const hiddenCount = shouldCollapse ? toolGroup.length - 2 : 0;

          return (
            <div key={`group-${groupIndex}`}>
              {visibleTools.map((part, index) => {
                const disabled = isToolDisabled(part, allToolsFlat, firstPendingApprovalIdx);

                return (
                  <div key={`tool-${groupIndex}-${index}`}>
                    {getComponent(part, disabled)}
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
