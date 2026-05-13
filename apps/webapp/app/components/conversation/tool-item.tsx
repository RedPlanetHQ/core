import { useEffect, useRef, useState } from "react";
import { cn } from "~/lib/utils";
import { type ChatAddToolApproveResponseFunction } from "ai";
import {
  loadIntegrationBundle,
  type ToolUIComponent,
} from "~/utils/integration-loader.client";
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
import { SuggestIntegrationsCards } from "./suggest-integrations-cards";

export const Tool = ({
  part,
  addToolApprovalResponse,
  isDisabled = false,
  allToolsFlat = [],
  firstPendingApprovalIdx = -1,
  isNested = false,
  integrationAccountMap = {},
  integrationFrontendMap = {},
  setToolArgOverride,
}: {
  part: ConversationToolPart;
  addToolApprovalResponse: ChatAddToolApproveResponseFunction;
  isDisabled?: boolean;
  allToolsFlat?: ConversationToolPart[];
  firstPendingApprovalIdx?: number;
  isNested?: boolean;
  integrationAccountMap?: Record<string, string>;
  integrationFrontendMap?: Record<string, string>;
  setToolArgOverride?: (
    toolCallId: string,
    args: Record<string, unknown>,
  ) => void;
}) => {
  const toolName = part.type.replace("tool-", "");
  const needsApproval = part.state === "approval-requested";

  // AI SDK v6 uses 'input-streaming' / 'input-available' while a tool is running.
  // Our synthetic nested parts still use 'in-progress'. Treat anything that isn't
  // a completed or denied state as "running".
  const isRunning =
    part.state !== "output-available" &&
    part.state !== "output-error" &&
    part.state !== "output-denied" &&
    part.state !== "approval-responded";

  // AI SDK top-level tool parts use `args`; our synthetic nested parts use `input`.
  // Normalize once so all downstream code just reads `input`.
  const input: Record<string, any> =
    part.input ??
    (part as unknown as { args?: Record<string, unknown> }).args ??
    {};

  // Get all nested parts from output
  const allNestedParts = getNestedPartsFromOutput(part.output);

  // Filter to get only tool parts
  const liveNestedToolParts = allNestedParts.filter(
    (item): item is ConversationToolPart => item.type.includes("tool-"),
  );

  // Cache toolCalls seen in nested parts. The resumed stream (after approval)
  // sends only toolResults — no toolCalls — so liveNestedToolParts becomes
  // empty. The ref preserves the last known tool calls so we can still render
  // them and update their state when the matching results arrive.
  const cachedNestedPartsRef = useRef<ConversationToolPart[]>([]);
  if (liveNestedToolParts.length > 0) {
    cachedNestedPartsRef.current = liveNestedToolParts;
  }

  const nestedToolParts: ConversationToolPart[] = (() => {
    if (liveNestedToolParts.length > 0) return liveNestedToolParts;
    const cached = cachedNestedPartsRef.current;
    if (cached.length === 0) return [];

    // Extract toolResults from output to update cached parts' state
    const rawOut = part.output as Record<string, unknown> | null | undefined;
    if (!rawOut || typeof rawOut !== "object") return cached;
    const steps = Array.isArray(rawOut.steps) ? rawOut.steps : [];
    const lastStep = steps[steps.length - 1] as
      | Record<string, unknown>
      | undefined;
    const allResults: Array<{ toolCallId: string; result: unknown }> = [
      ...((rawOut.toolResults as any[]) ?? []).map((r: any) => r.payload ?? r),
      ...((lastStep?.toolResults as any[]) ?? []).map(
        (r: any) => r.payload ?? r,
      ),
    ];

    return cached.map((cachedPart) => {
      const match = allResults.find(
        (r) => r.toolCallId === cachedPart.toolCallId,
      );
      if (!match) return cachedPart;
      return {
        ...cachedPart,
        state: "output-available" as ToolPartState,
        output: match.result,
      };
    });
  })();

  const hasNestedTools = nestedToolParts.length > 0;

  // Check if any nested tool (at any depth) needs approval (to auto-open)
  const hasNestedApproval =
    hasNestedTools && hasNeedsApprovalDeep(nestedToolParts);

  const [isOpen, setIsOpen] = useState(!needsApproval && hasNestedApproval);

  // ── ToolUI ──────────────────────────────────────────────────────────────────
  // For execute_integration_action tools, the effective action is input.action.
  const effectiveAction =
    toolName === "execute_integration_action" &&
    typeof input.action === "string"
      ? input.action
      : null;

  const accountId =
    typeof input.accountId === "string" ? input.accountId : undefined;
  const frontendUrl = accountId ? integrationFrontendMap[accountId] : undefined;

  const [ToolUIComp, setToolUIComp] = useState<ToolUIComponent | null>(null);
  // Track which state we last loaded toolUI for to avoid redundant loads
  // but allow re-loading when transitioning between phases.
  const toolUILoadedForState = useRef<string | null>(null);

  useEffect(() => {
    if (!effectiveAction || !frontendUrl) return;

    // Only render ToolUI when output is available (phase 2)
    // Phase 1 ToolUI is handled by ToolApprovalPanel
    const isPhase2 = part.state === "output-available";
    if (!isPhase2) return;

    // Already loaded for this exact state — skip
    if (toolUILoadedForState.current === part.state) return;
    toolUILoadedForState.current = part.state;

    (async () => {
      try {
        const { toolUI } = await loadIntegrationBundle(frontendUrl);
        if (!toolUI?.supported_tools.includes(effectiveAction)) return;

        const rawOutput = part.output;
        const parsedOutput = (() => {
          if (typeof rawOutput === "string") {
            try {
              return JSON.parse(rawOutput);
            } catch {
              return rawOutput;
            }
          }
          return rawOutput;
        })();
        const result =
          parsedOutput !== null &&
          typeof parsedOutput === "object" &&
          "content" in parsedOutput
            ? (parsedOutput as Record<string, unknown>)
            : parsedOutput;

        let inputParameters = {};

        try {
          inputParameters = JSON.parse(input["parameters"]);
        } catch {}

        const Comp = await toolUI.render(
          effectiveAction,
          inputParameters,
          result,
          { placement: "webapp" },
          (newInput) => {
            if (setToolArgOverride && part.toolCallId) {
              setToolArgOverride(part.toolCallId, {
                ...input,
                parameters: JSON.stringify(newInput),
              });
            }
            if (part.approval?.id) {
              addToolApprovalResponse({ id: part.approval.id, approved: true });
            }
            // keep collapsible open so user can see the submitted state
          },
          () => {
            if (part.approval?.id) {
              addToolApprovalResponse({
                id: part.approval.id,
                approved: false,
              });
            }
            setIsOpen(false);
          },
        );

        setToolUIComp(() => Comp as ToolUIComponent);
      } catch {
        // fall through to default rendering
      }
    })();
  }, [effectiveAction, frontendUrl, part.state]);
  // ────────────────────────────────────────────────────────────────────────────

  // Extract text parts from output (non-tool content)
  const textPart = allNestedParts
    .filter((item) => !item.type.includes("tool-") && "text" in item)
    .map((t) => ("text" in t ? t.text : ""))
    .filter(Boolean)
    .join("\n");

  useEffect(() => {
    if (needsApproval) {
      setIsOpen(false);
    } else if (hasNestedApproval) {
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
    // Synthetic nested parts use "in-progress"; real parts may use "input-available" etc.
    const last = [...parts]
      .reverse()
      .find(
        (p) =>
          p.state !== "output-available" &&
          p.state !== "output-error" &&
          p.state !== "output-denied" &&
          p.state !== "approval-responded",
      );
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
    if (!isOpen && isRunning && hasNestedTools) {
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

  // progress_update → small italicized status line. Streamed live by
  // any agent (main, orchestrator, gateway) while doing long work.
  if (toolName === "progress_update") {
    const msg = typeof input.message === "string" ? input.message : undefined;
    if (!msg) return null;
    return (
      <div className="text-muted-foreground flex items-center gap-1.5 py-0.5 text-sm italic">
        <span>{msg}</span>
      </div>
    );
  }

  // suggest_integrations → inline connect cards. The tool returns a
  // JSON payload with cards: [{ slug, name, icon, definitionId, reason }].
  if (toolName === "suggest_integrations") {
    return <SuggestIntegrationsCards part={part} />;
  }

  // complete_onboarding → silent in the chat. The onboarding page
  // detects this via revalidation and redirects to /home/daily.
  if (toolName === "complete_onboarding") {
    return null;
  }

  // take_action → render nested tools flat, no collapsible wrapper
  if (toolName === "take_action" || toolName === "agent-take_action") {
    if (!hasNestedTools && part.state !== "output-available") {
      return (
        <div className="text-muted-foreground flex items-center gap-2 py-1">
          <LoaderCircle className="h-4 w-4 animate-spin" />
          <span className="text-sm">
            {needsApproval ? "Awaiting approval..." : "Working..."}
          </span>
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
          const nestedDisabled =
            needsApproval ||
            isToolDisabled(nestedPart, allToolsFlat, firstPendingApprovalIdx);
          return (
            <div key={`flat-${idx}`}>
              <Tool
                part={nestedPart}
                addToolApprovalResponse={addToolApprovalResponse}
                isDisabled={nestedDisabled}
                allToolsFlat={allToolsFlat}
                firstPendingApprovalIdx={firstPendingApprovalIdx}
                isNested={false}
                integrationAccountMap={integrationAccountMap}
                integrationFrontendMap={integrationFrontendMap}
                setToolArgOverride={setToolArgOverride}
              />
            </div>
          );
        })}
      </div>
    );
  }

  function getIcon() {
    if (part.state === "output-denied") {
      return <TriangleAlert size={16} className="rounded-sm" />;
    }

    if (isRunning && !hasNestedTools) {
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
      typeof input.query === "string"
        ? input.query
        : typeof input.action === "string"
          ? input.action
          : (Object.values(input).find((v) => typeof v === "string") as
              | string
              | undefined);
    return str ?? null;
  })();

  // Render leaf tool (no nested tools) — compact output
  const renderLeafContent = () => {
    // If a ToolUI component is loaded, render it instead of raw JSON
    if (ToolUIComp) {
      return (
        <div className="py-1">
          <ToolUIComp />
        </div>
      );
    }

    if (needsApproval) {
      const hasArgs = Object.keys(input).length > 0;
      if (!hasArgs) return null;
      return (
        <div className="bg-grayAlpha-100 my-2 rounded p-2">
          <pre className="text-muted-foreground max-h-[150px] overflow-auto font-mono text-sm">
            {JSON.stringify(input, null, 2)}
          </pre>
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
    return (
      <div className="mt-1">
        {ownFullInput && (
          <p className="text-muted-foreground mb-2 ml-2 whitespace-pre-wrap border-l border-gray-300 pl-3 text-sm leading-relaxed">
            {ownFullInput}
          </p>
        )}
        {nestedToolParts.map((nestedPart, idx) => {
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
                integrationFrontendMap={integrationFrontendMap}
                setToolArgOverride={setToolArgOverride}
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
        "my-0.5 w-full",
        isNested && "ml-2 border-l border-gray-300 pl-3",
        isDisabled && "cursor-not-allowed opacity-50",
      )}
    >
      <CollapsibleTrigger asChild>
        <Button
          variant="ghost"
          className={cn(
            "text-muted-foreground/50 hover:text-muted-foreground group -ml-2 flex items-center gap-2 py-1 text-left hover:cursor-pointer",
            isDisabled && "cursor-not-allowed",
          )}
          disabled={isDisabled || needsApproval}
        >
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
          <span className="text-muted-foreground ml-auto hidden shrink-0 group-hover:inline-flex">
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
