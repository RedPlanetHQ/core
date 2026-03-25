import { EditorContent, useEditor } from "@tiptap/react";

import { useEffect, memo, useState } from "react";
import { cn } from "~/lib/utils";
import { extensionsForConversation } from "./editor-extensions";
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
import {
  Bell,
  ChevronDown,
  ChevronRight,
  Clock,
  LayoutGrid,
  LoaderCircle,
  Search,
  TriangleAlert,
} from "lucide-react";
import { ApprovalComponent } from "./approval-component";
import {
  findAllToolsDeep,
  findFirstPendingApprovalIndex,
  isToolDisabled,
  hasNeedsApprovalDeep,
  getToolDisplayName,
} from "./conversation-utils";
import { ICON_MAPPING } from "../icon-utils";
import type { IconType } from "../icon-utils";
import { Task } from "../icons/task";

interface AIConversationItemProps {
  message: UIMessage;
  addToolApprovalResponse: ChatAddToolApproveResponseFunction;
  integrationAccountMap?: Record<string, string>;
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
  // Mastra subagent streaming format (from merged data-tool-agent chunks):
  // { toolCalls, toolResults, text, steps }
  // Convert to parts format for rendering
  if (output.toolCalls || output.toolResults || output.steps) {
    const parts: any[] = [];
    // Use latest step's data if available, otherwise top-level
    const source = output.steps?.length > 0
      ? output.steps[output.steps.length - 1]
      : output;
    // Deduplicate toolCalls by toolCallId (streaming may send duplicates)
    const seenCallIds = new Set<string>();
    for (const tc of source.toolCalls ?? []) {
      const call = tc.payload ?? tc;
      if (seenCallIds.has(call.toolCallId)) continue;
      seenCallIds.add(call.toolCallId);
      const allResults = source.toolResults ?? output.toolResults ?? [];
      const tr = allResults.find((r: any) => {
        const result = r.payload ?? r;
        return result.toolCallId === call.toolCallId;
      });
      const result = tr?.payload ?? tr;
      parts.push({
        type: `tool-${call.toolName}`,
        toolCallId: call.toolCallId,
        toolName: call.toolName,
        state: result?.result !== undefined ? "output-available" : "in-progress",
        input: call.args,
        ...(result?.result !== undefined && { output: result.result }),
      });
    }
    if (source.text || output.text) {
      parts.push({ type: "text", text: source.text || output.text });
    }
    return parts;
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
  integrationAccountMap = {},
}: {
  part: ToolUIPart<any>;
  addToolApprovalResponse: ChatAddToolApproveResponseFunction;
  isDisabled?: boolean;
  allToolsFlat?: any[];
  firstPendingApprovalIdx?: number;
  isNested?: boolean;
  integrationAccountMap?: Record<string, string>;
}) => {
  const toolName = part.type.replace("tool-", "");
  const needsApproval = part.state === "approval-requested";

  // Get all nested parts from output (handles both .parts and .content)
  const allNestedParts = getNestedPartsFromOutput((part as any).output);

  // Filter to get only tool parts
  const nestedToolParts = allNestedParts.filter((item: any) =>
    item.type?.includes("tool-"),
  );
  const hasNestedTools = nestedToolParts.length > 0;

  // Check if any nested tool (at any depth) needs approval (to auto-open)
  const hasNestedApproval =
    hasNestedTools && hasNeedsApprovalDeep(nestedToolParts);

  const [isOpen, setIsOpen] = useState(needsApproval || hasNestedApproval);

  // Extract text parts from output (non-tool content)
  const textParts = allNestedParts.filter(
    (item: any) =>
      !item.type?.includes("tool-") && (item.text || item.type === "text"),
  );
  const textPart = textParts
    .map((t: any) => t.text)
    .filter(Boolean)
    .join("\n");

  const handleApprove = () => {
    if (addToolApprovalResponse && (part as any)?.approval?.id && !isDisabled) {
      addToolApprovalResponse({
        id: (part as any)?.approval?.id,
        approved: true,
      });
      setIsOpen(false);
    }
  };

  const handleReject = () => {
    if (addToolApprovalResponse && (part as any)?.approval?.id && !isDisabled) {
      addToolApprovalResponse({
        id: (part as any)?.approval?.id,
        approved: false,
      });
      setIsOpen(false);
    }
  };

  useEffect(() => {
    if (needsApproval || hasNestedApproval) {
      setIsOpen(true);
    }
  }, [needsApproval, hasNestedApproval]);

  // acknowledge → inline update notification, no collapsible
  if (toolName === "acknowledge") {
    const msg = (part as any).input?.message;
    return (
      <div className="flex items-center gap-1.5 py-0.5">
        <span>{msg || "Processing..."}</span>
      </div>
    );
  }

  // take_action → render nested tools flat, no collapsible wrapper
  if (toolName === "take_action" || toolName === "agent-take_action") {
    if (!hasNestedTools && part.state !== "output-available") {
      return (
        <div className="text-muted-foreground flex items-center gap-2 py-1">
          <LoaderCircle className="h-4 w-4 animate-spin" />
          <span className="text-sm">Working...</span>
        </div>
      );
    }
    return (
      <div
        className={cn(
          "w-full",
          isNested && "ml-2 border-l border-gray-300 pl-3",
        )}
      >
        {nestedToolParts.map((nestedPart: any, idx: number) => {
          const nestedDisabled = isToolDisabled(
            nestedPart,
            allToolsFlat,
            firstPendingApprovalIdx,
          );
          return (
            <Tool
              key={`flat-${idx}`}
              part={nestedPart}
              addToolApprovalResponse={addToolApprovalResponse}
              isDisabled={nestedDisabled}
              allToolsFlat={allToolsFlat}
              firstPendingApprovalIdx={firstPendingApprovalIdx}
              isNested={false}
              integrationAccountMap={integrationAccountMap}
            />
          );
        })}
      </div>
    );
  }

  function getIcon() {
    if (part.state === "output-denied") {
      return <TriangleAlert size={16} className="rounded-sm" />;
    }

    if (part.state === "in-progress" && !hasNestedTools) {
      return <LoaderCircle className="h-4 w-4 animate-spin" />;
    }

    if (toolName === "gather_context" || toolName === "agent-gather_context") {
      return <Search size={16} />;
    }

    // Task tools
    if (
      toolName === "create_task" ||
      toolName === "list_tasks" ||
      toolName === "update_task"
    ) {
      return <Task size={16} />;
    }

    // Reminder tools
    if (
      toolName === "add_reminder" ||
      toolName === "update_reminder" ||
      toolName === "delete_reminder" ||
      toolName === "list_reminders" ||
      toolName === "confirm_reminder" ||
      toolName === "set_timezone"
    ) {
      return <Clock size={16} />;
    }

    // Integration tools — resolve slug from accountId
    if (
      toolName === "execute_integration_action" ||
      toolName === "get_integration_actions"
    ) {
      const accountId = (part as any).input?.accountId;
      const slug = accountId ? integrationAccountMap[accountId] : undefined;
      if (slug) {
        const IconComponent = ICON_MAPPING[slug as IconType];
        if (IconComponent) {
          return <IconComponent size={16} />;
        }
      }
      return <LayoutGrid size={16} />;
    }

    return <StaticLogo size={16} className="rounded-sm" />;
  }

  // Get the display name for this tool
  const displayName = (() => {
    const toTitleCase = (s: string) =>
      s
        .split("_")
        .map((w, i) => (i === 0 ? w.charAt(0).toUpperCase() + w.slice(1) : w))
        .join(" ");
    if (
      toolName === "execute_integration_action" &&
      (part as any).input?.action
    ) {
      return toTitleCase((part as any).input.action as string);
    }

    if (toolName === "get_integration_actions" && (part as any).input?.query) {
      return `Get tool · ${(part as any).input.query as string}`;
    }
    if ((toolName === "gather_context" || toolName === "agent-gather_context") && (part as any).input?.query) {
      const q = (part as any).input.query as string;
      const truncated = q.length > 30 ? q.slice(0, 30) + "..." : q;
      return `Gather context · ${truncated}`;
    }
    return getToolDisplayName(part.type);
  })();

  const isGatherContext = toolName === "gather_context" || toolName === "agent-gather_context";
  const gatherContextQuery =
    isGatherContext ? (part as any).input?.query : null;

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
        <ApprovalComponent onApprove={handleApprove} onReject={handleReject} />
      );
    }

    // Get input args
    const args = (part as any).input;
    const hasArgs = args && Object.keys(args).length > 0;

    // Show JSON output for leaf tools
    const output = (part as any).output;
    const outputContent = output?.content || output;

    return (
      <div className="bg-grayAlpha-50 mt-1 rounded p-2">
        {hasArgs && (
          <div className="bg-grayAlpha-100 mb-2 rounded p-2">
            <p className="text-muted-foreground mb-1 text-xs font-medium">
              Input
            </p>
            <pre className="text-success max-h-[200px] overflow-auto rounded p-2 font-mono text-xs">
              {JSON.stringify(args, null, 2)}
            </pre>
          </div>
        )}
        <div className="bg-grayAlpha-100 rounded p-2">
          <p className="text-muted-foreground mb-1 text-xs font-medium">
            Result
          </p>
          <pre className="max-h-[200px] overflow-auto rounded p-2 font-mono text-xs text-[#BF4594]">
            {typeof outputContent === "string"
              ? outputContent
              : JSON.stringify(outputContent, null, 2)}
          </pre>
        </div>
      </div>
    );
  };

  // Render nested tools (parent node)
  const renderNestedContent = () => {
    return (
      <div className="mt-1">
        {gatherContextQuery && (
          <p className="text-muted-foreground mb-2 ml-2 whitespace-pre-wrap border-l border-gray-300 pl-3 text-sm leading-relaxed">
            {gatherContextQuery}
          </p>
        )}
        {nestedToolParts.map((nestedPart: any, idx: number) => {
          const nestedDisabled = isToolDisabled(
            nestedPart,
            allToolsFlat,
            firstPendingApprovalIdx,
          );
          return (
            <div key={`nested-${idx}`}>
              {idx > 0 && <div className="ml-3" />}
              <Tool
                part={nestedPart}
                addToolApprovalResponse={addToolApprovalResponse}
                isDisabled={nestedDisabled}
                allToolsFlat={allToolsFlat}
                firstPendingApprovalIdx={firstPendingApprovalIdx}
                isNested={true}
                integrationAccountMap={integrationAccountMap}
              />
            </div>
          );
        })}
        {textPart && (
          <div className="py-1">
            <p className="text-muted-foreground mb-1 text-xs font-medium">
              Response
            </p>
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
        "mt-1 w-full",
        isNested && "ml-2 border-l border-gray-300 pl-3",
        isDisabled && "cursor-not-allowed opacity-50",
      )}
    >
      <CollapsibleTrigger asChild>
        <Button
          variant="ghost"
          className={cn(
            "text-muted-foreground/80 -ml-2 flex items-center gap-2 py-1 text-left hover:cursor-pointer",
            isDisabled && "cursor-not-allowed",
          )}
          disabled={isDisabled}
        >
          {getIcon()}
          <span>{displayName}</span>
          <span className="text-muted-foreground">
            {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </span>
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent className={cn("w-full", isNested && "pl-3")}>
        {hasNestedTools ? renderNestedContent() : renderLeafContent()}
      </CollapsibleContent>
    </Collapsible>
  );
};

const ConversationItemComponent = ({
  message,
  addToolApprovalResponse,
  integrationAccountMap = {},
}: AIConversationItemProps) => {
  const isUser = message.role === "user" || false;
  const textPart = message.parts.find((part) => part.type === "text");
  const [showAllTools, setShowAllTools] = useState(false);

  const editor = useEditor({
    extensions: [...extensionsForConversation],
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

  // Merge data-tool-agent parts into their parent agent tool parts.
  // Mastra streams subagent activity as separate "data-tool-agent" sibling parts
  // instead of nesting them inside the parent tool's output during streaming.
  const mergedParts = (() => {
    const result: any[] = [];
    let lastAgentTool: any = null;

    for (const part of message.parts) {
      // data-tool-agent parts contain subagent's toolCalls/toolResults/text/steps
      if ((part as any).type === "data-tool-agent" || (part as any).type === "tool-agent") {
        // Merge into the preceding agent tool part's output
        if (lastAgentTool) {
          const agentData = (part as any).data ?? part;
          if (!lastAgentTool.output || typeof lastAgentTool.output !== "object") {
            lastAgentTool.output = {};
          }
          // Accumulate toolCalls and toolResults from streaming chunks
          if (agentData.toolCalls) {
            lastAgentTool.output.toolCalls = [
              ...(lastAgentTool.output.toolCalls ?? []),
              ...agentData.toolCalls,
            ];
          }
          if (agentData.toolResults) {
            lastAgentTool.output.toolResults = [
              ...(lastAgentTool.output.toolResults ?? []),
              ...agentData.toolResults,
            ];
          }
          if (agentData.steps) {
            lastAgentTool.output.steps = agentData.steps;
          }
          if (agentData.text) {
            lastAgentTool.output.text = agentData.text;
          }
        }
        // Don't add data-tool-agent to result — it's merged into parent
        continue;
      }

      // Track the last agent tool part (agent-gather_context, agent-take_action, etc.)
      const toolName = (part as any).type?.replace?.("tool-", "") ?? "";
      if (toolName.startsWith("agent-")) {
        // Clone to avoid mutating the original message part
        const cloned = { ...(part as any) };
        lastAgentTool = cloned;
        result.push(cloned);
      } else {
        result.push(part);
        // Reset tracker for non-agent tools
        if ((part as any).type?.includes?.("tool-")) {
          lastAgentTool = null;
        }
      }
    }
    return result;
  })();

  // Group consecutive tools together
  const groupedParts: Array<{ type: "tool-group" | "single"; parts: any[] }> =
    [];
  let currentToolGroup: any[] = [];

  mergedParts.forEach((part) => {
    if (part.type?.includes("tool-")) {
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
                reason: "don't call this",
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
    if (part.type?.includes("tool-")) {
      return (
        <Tool
          part={part as any}
          addToolApprovalResponse={handleToolApproval}
          isDisabled={isDisabled}
          allToolsFlat={allToolsFlat}
          firstPendingApprovalIdx={firstPendingApprovalIdx}
          integrationAccountMap={integrationAccountMap}
        />
      );
    }

    if (part.type?.includes("text")) {
      return (
        <EditorContent
          editor={editor}
          className="editor-container pt-1"
          defaultValue={part.content}
        />
      );
    }

    if (part.type === "file" && (part as any).mediaType?.startsWith("image/")) {
      return (
        <img
          src={(part as any).url}
          alt={(part as any).filename ?? "attachment"}
          className="mt-2 max-h-[400px] max-w-full rounded-md object-contain"
        />
      );
    }

    return null;
  };

  return (
    <div
      className={cn(
        "flex w-full gap-2 px-5 pb-2",
        isUser && "my-4 justify-end",
      )}
    >
      <div
        className={cn(
          "flex w-full flex-col",
          isUser && "bg-grayAlpha-100 w-fit rounded-md p-2",
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

          // Handle tool group
          const toolGroup = group.parts;
          const shouldCollapse = toolGroup.length > 3;
          const visibleTools =
            shouldCollapse && !showAllTools ? toolGroup.slice(0, 2) : toolGroup;
          const hiddenCount = shouldCollapse ? toolGroup.length - 2 : 0;

          return (
            <div key={`group-${groupIndex}`}>
              {visibleTools.map((part, index) => {
                const disabled = isToolDisabled(
                  part,
                  allToolsFlat,
                  firstPendingApprovalIdx,
                );

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
