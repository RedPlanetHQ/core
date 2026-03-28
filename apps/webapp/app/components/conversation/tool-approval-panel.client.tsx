import { useEffect, useRef, useState } from "react";
import { type ChatAddToolApproveResponseFunction } from "ai";
import { LayoutGrid, Zap } from "lucide-react";
import { loadIntegrationBundle, type ToolUIComponent } from "~/utils/integration-loader.client";
import { ApprovalComponent } from "./approval-component";
import {
  type ConversationToolPart,
  getNestedPartsFromOutput,
  getToolDisplayName,
} from "./conversation-utils";
import { ICON_MAPPING } from "../icon-utils";
import type { IconType } from "../icon-utils";

interface ToolApprovalCardProps {
  part: ConversationToolPart;
  isActive: boolean;
  onApproval: (
    approvalId: string,
    approved: boolean,
    toolCallId: string,
  ) => void;
  isChatBusy?: boolean;
  integrationAccountMap?: Record<string, string>;
  integrationFrontendMap?: Record<string, string>;
  setToolArgOverride?: (
    toolCallId: string,
    args: Record<string, unknown>,
  ) => void;
}

function ToolApprovalCard({
  part,
  isActive,
  onApproval,
  isChatBusy,
  integrationAccountMap = {},
  integrationFrontendMap = {},
  setToolArgOverride,
}: ToolApprovalCardProps) {
  const toolName = part.type.replace("tool-", "");
  const input: Record<string, any> = part.input ?? (part as any).args ?? {};

  // Use a ref so ToolUI closures always call the latest handler
  const onApprovalRef = useRef(onApproval);
  onApprovalRef.current = onApproval;

  // ToolUI loading (phase 1 — approval-requested)
  const effectiveAction =
    toolName === "execute_integration_action" &&
    typeof input.action === "string"
      ? input.action
      : null;
  const accountId =
    typeof input.accountId === "string" ? input.accountId : undefined;
  const frontendUrl = accountId ? integrationFrontendMap[accountId] : undefined;

  const [ToolUIComp, setToolUIComp] = useState<ToolUIComponent | null>(null);
  const loadedRef = useRef(false);

  useEffect(() => {
    if (!isActive || !effectiveAction || !frontendUrl || loadedRef.current)
      return;
    loadedRef.current = true;

    (async () => {
      try {
        const { toolUI } = await loadIntegrationBundle(frontendUrl);
        if (!toolUI?.supported_tools.includes(effectiveAction)) return;

        let inputParameters = {};
        try {
          inputParameters = JSON.parse(input["parameters"]);
        } catch {}

        const Comp = await toolUI.render(
          effectiveAction,
          inputParameters,
          null,
          { placement: "webapp" },
          (newInput) => {
            if (setToolArgOverride && part.toolCallId) {
              setToolArgOverride(part.toolCallId, {
                ...input,
                parameters: JSON.stringify(newInput),
              });
            }
            if (part.approval?.id) {
              onApprovalRef.current(part.approval.id, true, part.toolCallId);
            }
          },
          () => {
            if (part.approval?.id) {
              onApprovalRef.current(part.approval.id, false, part.toolCallId);
            }
          },
        );
        setToolUIComp(() => Comp as ToolUIComponent);
      } catch {
        // fall through to default rendering
      }
    })();
  }, [isActive, effectiveAction, frontendUrl]);

  const getIcon = () => {
    if (
      toolName === "execute_integration_action" ||
      toolName === "get_integration_actions"
    ) {
      const slug = accountId ? integrationAccountMap[accountId] : undefined;
      if (slug) {
        const IconComponent = ICON_MAPPING[slug as IconType];
        if (IconComponent) return <IconComponent size={14} />;
      }
      return <LayoutGrid size={14} />;
    }
    return null;
  };

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

  // Nested tools for take_action (shown as preview)
  const nestedParts =
    toolName === "take_action" || toolName === "agent-take_action"
      ? getNestedPartsFromOutput(part.output).filter(
          (p): p is ConversationToolPart => p.type.includes("tool-"),
        )
      : [];

  const handleApprove = () => {
    if (part.approval?.id) onApproval(part.approval.id, true, part.toolCallId);
  };
  const handleReject = () => {
    if (part.approval?.id) onApproval(part.approval.id, false, part.toolCallId);
  };

  if (!isActive) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 opacity-40">
        {getIcon()}
        <span className="text-sm">{displayName}</span>
        <span className="text-muted-foreground ml-auto text-xs">Queued</span>
      </div>
    );
  }

  return (
    <div className="px-3 py-3">
      <div className="mb-2 flex items-center gap-2">
        {getIcon()}
        <span className="text-sm font-medium">{displayName}</span>
      </div>

      {ToolUIComp ? (
        <ToolUIComp />
      ) : (
        <>
          {nestedParts.length > 0 ? (
            <div className="bg-grayAlpha-50 mb-2 rounded p-2">
              <p className="text-muted-foreground mb-1 text-xs font-medium">
                Will execute
              </p>
              {nestedParts.map((np, i) => (
                <div key={i} className="text-muted-foreground py-0.5 text-sm">
                  · {getToolDisplayName(np.type)}
                </div>
              ))}
            </div>
          ) : Object.keys(input).length > 0 ? (
            <div className="bg-grayAlpha-100 mb-2 rounded p-2">
              <pre className="text-muted-foreground max-h-[150px] overflow-auto font-mono text-sm">
                {JSON.stringify(input, null, 2)}
              </pre>
            </div>
          ) : null}
          <ApprovalComponent
            onApprove={handleApprove}
            onReject={handleReject}
            isChatBusy={isChatBusy}
          />
        </>
      )}
    </div>
  );
}

interface ToolApprovalPanelProps {
  pendingApprovals: ConversationToolPart[];
  addToolApprovalResponse: ChatAddToolApproveResponseFunction;
  isChatBusy?: boolean;
  integrationAccountMap?: Record<string, string>;
  integrationFrontendMap?: Record<string, string>;
  setToolArgOverride?: (
    toolCallId: string,
    args: Record<string, unknown>,
  ) => void;
}

export function ToolApprovalPanel({
  pendingApprovals,
  addToolApprovalResponse,
  isChatBusy,
  integrationAccountMap,
  integrationFrontendMap,
  setToolArgOverride,
}: ToolApprovalPanelProps) {
  // Local decisions: toolCallId → approved/declined
  // Tracks per-card decisions without immediately updating AI SDK state.
  const [localDecisions, setLocalDecisions] = useState<Map<string, boolean>>(
    new Map(),
  );

  if (pendingApprovals.length === 0) return null;

  const handleApproval = (
    approvalId: string,
    approved: boolean,
    toolCallId: string,
  ) => {
    const newDecisions = new Map(localDecisions);
    newDecisions.set(toolCallId, approved);

    // Record real decision into toolArgOverridesRef immediately
    setToolArgOverride?.(toolCallId, { approved });

    // If user declined, auto-decline ALL remaining undecided cards across all approvalIds
    if (!approved) {
      pendingApprovals.forEach((p) => {
        if (p.toolCallId && !newDecisions.has(p.toolCallId)) {
          newDecisions.set(p.toolCallId, false);
          setToolArgOverride?.(p.toolCallId, { approved: false });
        }
      });
    }

    setLocalDecisions(newDecisions);

    // For each approvalId where ALL cards are now decided, call addToolApprovalResponse
    // once (always approved:true — just transitions AI SDK state to approval-responded).
    const affectedIds = new Set<string>();
    affectedIds.add(approvalId);
    if (!approved) {
      pendingApprovals.forEach((p) => {
        if (p.approval?.id) affectedIds.add(p.approval.id);
      });
    }

    affectedIds.forEach((aid) => {
      const cardsForId = pendingApprovals.filter((p) => p.approval?.id === aid);
      const allDecided = cardsForId.every(
        (p) => p.toolCallId && newDecisions.has(p.toolCallId),
      );
      if (allDecided) {
        addToolApprovalResponse({ id: aid, approved: true });
      }
    });
  };

  return (
    <div className="mt-2 w-full pb-1">
      <div className="border-border overflow-hidden rounded-md border">
        <div className="bg-grayAlpha-50 border-border flex items-center gap-2 border-b px-3 py-2">
          <Zap size={14} className="text-muted-foreground" />
          <span className="text-sm font-medium">
            {pendingApprovals.length} action
            {pendingApprovals.length > 1 ? "s" : ""} require
            {pendingApprovals.length === 1 ? "s" : ""} approval
          </span>
        </div>
        {pendingApprovals.map((part, idx) => {
          // Active = first card whose toolCallId hasn't been decided yet
          const isActive =
            !localDecisions.has(part.toolCallId ?? "") &&
            pendingApprovals
              .slice(0, idx)
              .every((p) => localDecisions.has(p.toolCallId ?? ""));

          return (
            <div
              key={part.toolCallId ?? idx}
              className={idx > 0 ? "border-border border-t" : ""}
            >
              <ToolApprovalCard
                part={part}
                isActive={isActive}
                onApproval={handleApproval}
                isChatBusy={isChatBusy}
                integrationAccountMap={integrationAccountMap}
                integrationFrontendMap={integrationFrontendMap}
                setToolArgOverride={setToolArgOverride}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
