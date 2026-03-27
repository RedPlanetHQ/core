import { useEffect, useState } from "react";
import { cn } from "~/lib/utils";
import { type ChatAddToolApproveResponseFunction } from "ai";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "../ui/collapsible";
import StaticLogo from "../logo/logo";
import { Button } from "../ui";
import {
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
  type ConversationToolPart,
  type ToolPartState,
  getNestedPartsFromOutput,
  hasNeedsApprovalDeep,
  isToolDisabled,
  getToolDisplayName,
} from "./conversation-utils";
import { ICON_MAPPING } from "../icon-utils";
import type { IconType } from "../icon-utils";
import { Task } from "../icons/task";

export const Tool = ({
  part,
  addToolApprovalResponse,
  isDisabled = false,
  allToolsFlat = [],
  firstPendingApprovalIdx = -1,
  isNested = false,
  integrationAccountMap = {},
}: {
  part: ConversationToolPart;
  addToolApprovalResponse: ChatAddToolApproveResponseFunction;
  isDisabled?: boolean;
  allToolsFlat?: ConversationToolPart[];
  firstPendingApprovalIdx?: number;
  isNested?: boolean;
  integrationAccountMap?: Record<string, string>;
}) => {
  const toolName = part.type.replace("tool-", "");
  const needsApproval = part.state === "approval-requested";

  // AI SDK top-level tool parts use `args`; our synthetic nested parts use `input`.
  // Normalize once so all downstream code just reads `input`.
  const input: Record<string, unknown> =
    part.input ??
    (part as unknown as { args?: Record<string, unknown> }).args ??
    {};

  // Get all nested parts from output
  const allNestedParts = getNestedPartsFromOutput(part.output);

  // Filter to get only tool parts
  const nestedToolParts = allNestedParts.filter(
    (item): item is ConversationToolPart => item.type.includes("tool-"),
  );
  const hasNestedTools = nestedToolParts.length > 0;

  // Check if any nested tool (at any depth) needs approval (to auto-open)
  const hasNestedApproval =
    hasNestedTools && hasNeedsApprovalDeep(nestedToolParts);

  const [isOpen, setIsOpen] = useState(needsApproval || hasNestedApproval);

  // Extract text parts from output (non-tool content)
  const textPart = allNestedParts
    .filter((item) => !item.type.includes("tool-") && "text" in item)
    .map((t) => ("text" in t ? t.text : ""))
    .filter(Boolean)
    .join("\n");

  const handleApprove = () => {
    if (addToolApprovalResponse && part.approval?.id && !isDisabled) {
      addToolApprovalResponse({ id: part.approval.id, approved: true });
      setIsOpen(false);
    }
  };

  const handleReject = () => {
    if (addToolApprovalResponse && part.approval?.id && !isDisabled) {
      addToolApprovalResponse({ id: part.approval.id, approved: false });
      setIsOpen(false);
    }
  };

  useEffect(() => {
    if (needsApproval || hasNestedApproval) {
      setIsOpen(true);
    }
  }, [needsApproval, hasNestedApproval]);

  // Extract the most relevant input hint from an args object (max 30 chars)
  const getInputHint = (args: Record<string, unknown>): string | null => {
    const str =
      typeof args.query === "string"
        ? args.query
        : typeof args.action === "string"
          ? args.action
          : (Object.values(args).find((v) => typeof v === "string") as
              | string
              | undefined);
    if (!str) return null;
    return str.length > 30 ? str.slice(0, 30) + "…" : str;
  };

  // Recursively find the deepest in-progress nested tool + its input hint
  interface NestedInfo {
    name: string;
    inputHint: string | null;
  }
  const getActiveNestedInfo = (
    parts: ConversationToolPart[],
  ): NestedInfo | null => {
    const last = [...parts].reverse().find((p) => p.state === "in-progress");
    if (!last) return null;
    const deeper = getNestedPartsFromOutput(last.output).filter(
      (p): p is ConversationToolPart => p.type.includes("tool-"),
    );
    if (deeper.length > 0) {
      const deeperInfo = getActiveNestedInfo(deeper);
      if (deeperInfo) return deeperInfo;
    }
    const nestedInput: Record<string, unknown> =
      last.input ??
      (last as unknown as { args?: Record<string, unknown> }).args ??
      {};
    return {
      name: getToolDisplayName(last.type),
      inputHint: getInputHint(nestedInput),
    };
  };

  // Trigger hint: changes based on state
  // - in-progress with nested tools → show active nested tool + its input
  // - otherwise → show own input hint
  type TriggerHint =
    | { kind: "nested"; info: NestedInfo }
    | { kind: "own"; hint: string };

  const triggerHint = ((): TriggerHint | null => {
    if (!isOpen && part.state === "in-progress" && hasNestedTools) {
      const info = getActiveNestedInfo(nestedToolParts);
      if (info) return { kind: "nested", info };
    }
    const ownHint = getInputHint(input);
    return ownHint ? { kind: "own", hint: ownHint } : null;
  })();

  // acknowledge → inline update notification, no collapsible
  if (toolName === "acknowledge") {
    const msg = typeof input.message === "string" ? input.message : undefined;
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
        {nestedToolParts.map((nestedPart, idx) => {
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

    if (
      toolName === "create_task" ||
      toolName === "list_tasks" ||
      toolName === "update_task"
    ) {
      return <Task size={16} />;
    }

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

    if (
      toolName === "execute_integration_action" ||
      toolName === "get_integration_actions"
    ) {
      const accountId =
        typeof input.accountId === "string" ? input.accountId : undefined;
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

  // Base display name — no input appended (hint shown separately in trigger)
  const displayName = (() => {
    if (
      toolName === "execute_integration_action" &&
      typeof input.action === "string"
    ) {
      return input.action
        .split("_")
        .map((w: string, i: number) =>
          i === 0 ? w.charAt(0).toUpperCase() + w.slice(1) : w,
        )
        .join(" ");
    }
    return getToolDisplayName(part.type);
  })();

  // Full (untruncated) primary input string shown at the top of the expanded view
  const ownFullInput = (() => {
    const str =
      typeof input.query === "string" ? input.query :
      typeof input.action === "string" ? input.action :
      (Object.values(input).find((v) => typeof v === "string") as string | undefined);
    return str ?? null;
  })();

  // Render leaf tool (no nested tools) — compact output
  const renderLeafContent = () => {
    if (needsApproval) {
      if (isDisabled) {
        return (
          <div className="text-muted-foreground py-1 text-sm">
            Waiting for previous tool approval...
          </div>
        );
      }
      const hasArgs = Object.keys(input).length > 0;
      return (
        <div>
          {hasArgs && (
            <div className="bg-grayAlpha-100 my-2 rounded p-2">
              <pre className="text-muted-foreground max-h-[150px] overflow-auto font-mono text-sm">
                {JSON.stringify(input, null, 2)}
              </pre>
            </div>
          )}
          <ApprovalComponent
            onApprove={handleApprove}
            onReject={handleReject}
          />
        </div>
      );
    }

    const hasArgs = Object.keys(input).length > 0;

    const rawOutput = part.output;
    const outputContent =
      typeof rawOutput === "object" &&
      rawOutput !== null &&
      "content" in rawOutput
        ? (rawOutput as { content: unknown }).content
        : rawOutput;

    return (
      <div className="bg-grayAlpha-50 mt-1 rounded p-2">
        {hasArgs && (
          <div className="bg-grayAlpha-100 mb-2 rounded p-2">
            <p className="text-muted-foreground mb-1 text-xs font-medium">
              Input
            </p>
            <pre className="text-success max-h-[200px] overflow-auto rounded p-2 font-mono text-sm">
              {JSON.stringify(input, null, 2)}
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
    // When parent has approval-requested, inject the approval into the last
    // in-progress nested tool so it shows at the correct level
    const parentApproval = needsApproval ? part.approval : null;

    return (
      <div className="mt-1">
        {ownFullInput && (
          <p className="text-muted-foreground mb-2 ml-2 whitespace-pre-wrap border-l border-gray-300 pl-3 text-sm leading-relaxed">
            {ownFullInput}
          </p>
        )}
        {nestedToolParts.map((nestedPart, idx) => {
          const isLastInProgress =
            parentApproval &&
            idx === nestedToolParts.length - 1 &&
            nestedPart.state === "in-progress";

          const effectivePart: ConversationToolPart = isLastInProgress
            ? {
                ...nestedPart,
                state: "approval-requested" as ToolPartState,
                approval: parentApproval ?? undefined,
              }
            : nestedPart;

          const nestedDisabled = isToolDisabled(
            nestedPart,
            allToolsFlat,
            firstPendingApprovalIdx,
          );
          return (
            <div key={`nested-${idx}`}>
              {idx > 0 && <div className="ml-3" />}
              <Tool
                part={effectivePart}
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
        "my-1 w-full",
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
          {triggerHint?.kind === "nested" ? (
            <span className="text-muted-foreground/60 flex min-w-0 items-center gap-1 text-sm">
              <LoaderCircle className="h-3 w-3 shrink-0 animate-spin" />
              <span className="shrink-0">{triggerHint.info.name}</span>
              {triggerHint.info.inputHint && (
                <span className="truncate opacity-70">
                  · {triggerHint.info.inputHint}
                </span>
              )}
            </span>
          ) : triggerHint?.kind === "own" ? (
            <span className="text-muted-foreground/60 max-w-[240px] truncate text-sm">
              · {triggerHint.hint}
            </span>
          ) : null}
          <span className="text-muted-foreground ml-auto shrink-0">
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
