import { useCallback, useEffect, useRef, useState } from "react";
import { useFetcher } from "@remix-run/react";
import { useLocalCommonState } from "~/hooks/use-local-state";
import { useChat, type UIMessage } from "@ai-sdk/react";
import {
  DefaultChatTransport,
  lastAssistantMessageIsCompleteWithApprovalResponses,
} from "ai";
import { UserTypeEnum } from "@core/types";
import { ConversationItem } from "./conversation-item.client";
import {
  ConversationTextarea,
  type LLMModel,
} from "./conversation-textarea.client";
import { ThinkingIndicator } from "./thinking-indicator.client";
import {
  collectApprovalRequests,
  hasNeedsApprovalDeep,
  mergeAgentParts,
} from "./conversation-utils";
import {
  PermissionModeSelector,
  type PermissionMode,
} from "./permission-mode-selector.client";
import { cn } from "~/lib/utils";

interface ConversationHistory {
  id: string;
  userType: string;
  message: string;
  parts: any;
  createdAt?: string;
}

interface ConversationViewProps {
  conversationId: string;
  history: ConversationHistory[];
  className?: string;
  integrationAccountMap?: Record<string, string>;
  integrationFrontendMap?: Record<string, string>;
  /** When true, auto-triggers regenerate if history has only 1 message */
  autoRegenerate?: boolean;
  /** DB conversation status — input is disabled when "running" */
  conversationStatus?: string;
  models?: LLMModel[];
  /** When true, hide the very first user message from the rendered chat
   *  while still keeping it in history (so the agent sees it). Used by
   *  onboarding to keep the hidden seed instruction out of the UI. */
  hideFirstUserMessage?: boolean;
  /** Optional callback fired after each streamed turn finishes. The
   *  onboarding page uses this to revalidate the loader — if the agent
   *  has called complete_onboarding, the next loader run sees the flag
   *  and redirects to /home/daily. */
  onStreamComplete?: () => void;
}

export function ConversationView({
  conversationId,
  history: historyProp,
  className,
  integrationAccountMap = {},
  integrationFrontendMap = {},
  autoRegenerate = false,
  conversationStatus: conversationStatusProp,
  models: modelsProp = [],
  hideFirstUserMessage = false,
  onStreamComplete,
}: ConversationViewProps) {
  // Local mirror of the loader-provided status — stays fresh across stop/
  // completion events without needing a route revalidation.
  const [conversationStatus, setConversationStatus] = useState(
    conversationStatusProp,
  );
  useEffect(() => {
    setConversationStatus(conversationStatusProp);
  }, [conversationStatusProp]);
  const history = historyProp ?? [];
  const readFetcher = useFetcher();
  const skillsFetcher = useFetcher<{
    skills: Array<{ id: string; title: string }>;
  }>();
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // Load skills once for slash command autocomplete
  useEffect(() => {
    skillsFetcher.load("/api/v1/skills?limit=100");
  }, []);
  const composerRef = useRef<HTMLDivElement>(null);
  const messageRefs = useRef<(HTMLDivElement | null)[]>([]);
  // initialize to history.length so mount doesn't trigger the scroll effect
  const prevMessageCountRef = useRef(history.length);
  // spacer height = scroll container clientHeight so any message can scroll to top
  const [spacerHeight, setSpacerHeight] = useState(0);
  // keeps spacer alive after streaming ends until user scrolls back to bottom
  const [keepSpacer, setKeepSpacer] = useState(false);

  const defaultModelId =
    modelsProp.find((m) => m.isDefault)?.id ?? modelsProp[0]?.id;
  const [selectedModelId, setSelectedModelId] = useLocalCommonState<
    string | undefined
  >("selectedModelId", defaultModelId);
  // Ref so prepareSendMessagesRequest always reads the latest selection
  const selectedModelRef = useRef<string | undefined>(selectedModelId);
  selectedModelRef.current = selectedModelId;

  const handleModelChange = (modelId: string) => {
    setSelectedModelId(modelId);
  };

  // Captures useChat.stop so handleStop can reference it without depending on
  // the hook call order.
  const stopRef = useRef<(() => void) | null>(null);

  const [isStopping, setIsStopping] = useState(false);

  const handleStop = useCallback(async () => {
    setIsStopping(true);
    try {
      await fetch(`/api/v1/conversation/${conversationId}/stop`, {
        method: "POST",
      });
    } catch {
      // best-effort: network issues shouldn't block the local UI stop
    }
    stopRef.current?.();
    setConversationStatus("cancelled");
    setIsStopping(false);
  }, [conversationId]);

  const [permissionMode, setPermissionMode] = useLocalCommonState<PermissionMode>(
    "conversationPermissionMode",
    "full",
  );
  const permissionModeRef = useRef<PermissionMode>(permissionMode ?? "full");
  permissionModeRef.current = permissionMode ?? "full";
  // toolCallId → { approved, ...argOverrides }
  // Single ref for both approval decisions and arg overrides
  const toolArgOverridesRef = useRef<Record<string, Record<string, unknown>>>(
    {},
  );

  // {approvalId, toolCallId}[] — one entry per suspended agent/tool call.
  // Populated by deep-scanning the last assistant message; reset on chat finish.
  const pendingApprovalRequestsRef = useRef<
    Array<{ approvalId: string; toolCallId: string }>
  >([]);

  const setToolArgOverride = useCallback(
    (toolCallId: string, args: Record<string, unknown>) => {
      toolArgOverridesRef.current = {
        ...toolArgOverridesRef.current,
        [toolCallId]: {
          ...(toolArgOverridesRef.current[toolCallId] ?? {}),
          ...args,
        },
      };
    },
    [],
  );

  const {
    sendMessage,
    messages,
    status,
    stop,
    regenerate,
    addToolApprovalResponse,
  } = useChat({
    id: conversationId,
    resume: true,
    onFinish: () => {
      toolArgOverridesRef.current = {};
      pendingApprovalRequestsRef.current = [];
      setConversationStatus("completed");
      readFetcher.submit(null, {
        method: "GET",
        action: `/api/v1/conversation/${conversationId}/read`,
      });
      onStreamComplete?.();
    },
    messages: history.map(
      (h) =>
        ({
          id: h.id,
          role: h.userType === UserTypeEnum.Agent ? "assistant" : "user",
          parts: h.parts ? h.parts : [{ text: h.message, type: "text" }],
        }) as UIMessage,
    ),
    transport: new DefaultChatTransport({
      api: "/api/v1/conversation",
      prepareSendMessagesRequest({ messages, id }) {
        const toolArgOverrides = toolArgOverridesRef.current;
        const hasApprovals = Object.values(toolArgOverrides).some(
          (e) => "approved" in e,
        );

        const permissionMode = permissionModeRef.current;

        if (hasApprovals) {
          return {
            body: { messages, needsApproval: true, id, toolArgOverrides, permissionMode },
          };
        }

        return {
          body: {
            message: messages[messages.length - 1],
            id,
            toolArgOverrides,
            modelId: selectedModelRef.current,
            permissionMode,
          },
        };
      },
      prepareReconnectToStreamRequest: ({ id }) => ({
        api: `/api/v1/conversation/${id}/stream`,
      }),
    }),
    // Fire when every suspended tool (across the full agent hierarchy) has a
    // recorded approve/decline decision in toolArgOverridesRef.
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithApprovalResponses,
  });

  stopRef.current = stop;

  useEffect(() => {
    if (
      autoRegenerate &&
      history.length === 1 &&
      conversationStatus !== "running"
    ) {
      regenerate();
    }
  }, []);

  // Measure scroll container and keep spacer in sync so any message can reach the top
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    const update = () => setSpacerHeight(container.clientHeight);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(container);
    return () => ro.disconnect();
  }, []);

  // On initial load, scroll to bottom to show latest messages
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (container) {
      container.scrollTop = container.scrollHeight;
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const input = composerRef.current?.querySelector(
        "[contenteditable='true']",
      );

      if (input instanceof HTMLElement) {
        input.focus();
      }
    }, 150);

    return () => window.clearTimeout(timer);
  }, [conversationId]);

  // Remove spacer when user scrolls back to bottom
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    const handleScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = container;
      if (scrollHeight - scrollTop - clientHeight < 30) {
        setKeepSpacer(false);
      }
    };
    container.addEventListener("scroll", handleScroll, { passive: true });
    return () => container.removeEventListener("scroll", handleScroll);
  }, []);

  // When a new user message is added, force-scroll it to the top of the container
  useEffect(() => {
    const newCount = messages.length;
    if (newCount > prevMessageCountRef.current) {
      const lastMsg = messages[newCount - 1];
      if (lastMsg.role === "user") {
        setKeepSpacer(true);
        requestAnimationFrame(() => {
          const el = messageRefs.current[newCount - 1];
          const container = scrollContainerRef.current;
          if (!el || !container) return;
          const elRect = el.getBoundingClientRect();
          const containerRect = container.getBoundingClientRect();
          const target =
            container.scrollTop + (elRect.top - containerRect.top) - 20;
          container.scrollTo({ top: Math.max(0, target), behavior: "smooth" });
        });
      }
    }
    prevMessageCountRef.current = newCount;
  }, [messages.length]);

  const lastAssistant = [...messages]
    .reverse()
    .find((m) => m.role === "assistant") as UIMessage | undefined;

  const needsApproval = lastAssistant?.parts
    ? hasNeedsApprovalDeep(lastAssistant.parts)
    : false;

  // Deep-scan the last assistant message for all suspended tool calls.
  // Keep the ref at the max seen set (stable during approval processing);
  // reset on chat finish (onFinish above).
  const currentApprovalRequests = lastAssistant
    ? collectApprovalRequests(mergeAgentParts(lastAssistant.parts))
    : [];
  if (
    currentApprovalRequests.length > pendingApprovalRequestsRef.current.length
  ) {
    pendingApprovalRequestsRef.current = currentApprovalRequests;
  }

  // Real decisions are recorded directly into toolArgOverridesRef via setToolArgOverride,
  // called from ToolApprovalPanel per card. This wrapper only updates AI SDK state
  // (approval-requested → approval-responded) — always approved:true.
  const handleToolApprovalResponse = useCallback(
    (params: { id: string; approved: boolean }) => {
      addToolApprovalResponse({ id: params.id, approved: true });
    },
    [addToolApprovalResponse],
  );

  return (
    <div
      className={cn(
        "flex h-full w-full flex-col justify-end overflow-hidden py-4 pb-12 lg:pb-4",
        className,
      )}
    >
      <div
        ref={scrollContainerRef}
        className="flex grow flex-col items-center overflow-y-auto"
      >
        <div className="flex w-full max-w-[90ch] flex-col pb-4">
          {messages.map((message: UIMessage, i: number) => {
            // Onboarding: the very first user message is a seed
            // instruction we keep in history (so the agent sees it)
            // but don't render in the UI.
            if (
              hideFirstUserMessage &&
              i === 0 &&
              message.role === "user"
            ) {
              return null;
            }
            return (
              <div
                key={i}
                ref={(el) => {
                  messageRefs.current[i] = el;
                }}
              >
                <ConversationItem
                  message={message}
                  createdAt={history[i]?.createdAt}
                  addToolApprovalResponse={handleToolApprovalResponse}
                  setToolArgOverride={setToolArgOverride}
                  isChatBusy={status === "streaming" || status === "submitted"}
                  integrationAccountMap={integrationAccountMap}
                  integrationFrontendMap={integrationFrontendMap}
                />
              </div>
            );
          })}
          {/* Spacer while streaming or until user scrolls back to bottom */}
          {(status === "streaming" || status === "submitted" || keepSpacer) && (
            <div style={{ height: spacerHeight, flexShrink: 0 }} />
          )}
        </div>
      </div>

      <div className="flex w-full shrink-0 flex-col items-center">
        <div ref={composerRef} className="w-full max-w-[90ch] px-4">
          <ThinkingIndicator
            isLoading={
              status === "streaming" ||
              status === "submitted" ||
              conversationStatus === "running"
            }
          />
          <ConversationTextarea
            className="pt-4"
            isLoading={
              status === "streaming" ||
              status === "submitted" ||
              conversationStatus === "running"
            }
            isStopping={isStopping}
            disabled={needsApproval}
            onConversationCreated={(message) => {
              if (message) sendMessage({ text: message });
            }}
            stop={handleStop}
            models={modelsProp}
            selectedModelId={selectedModelId}
            onModelChange={handleModelChange}
            skills={skillsFetcher.data?.skills}
            rightActions={
              <PermissionModeSelector
                value={permissionMode ?? "full"}
                onChange={setPermissionMode}
                disabled={
                  status === "streaming" ||
                  status === "submitted" ||
                  conversationStatus === "running"
                }
              />
            }
          />
        </div>
      </div>
    </div>
  );
}
