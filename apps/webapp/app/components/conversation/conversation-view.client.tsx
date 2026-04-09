import { useCallback, useEffect, useRef, useState } from "react";
import { useFetcher, useRevalidator } from "@remix-run/react";
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
  /** When true, add burst-safe latest-reply retries for strict proxy/self-hosted providers */
  enableBurstSafeFirstReplyRecovery?: boolean;
  /** DB conversation status — input is disabled when "running" */
  conversationStatus?: string;
  models?: LLMModel[];
}

export function ConversationView({
  conversationId,
  history,
  className,
  integrationAccountMap = {},
  integrationFrontendMap = {},
  autoRegenerate = false,
  enableBurstSafeFirstReplyRecovery = false,
  conversationStatus,
  models: modelsProp = [],
}: ConversationViewProps) {
  const [runtimeKey, setRuntimeKey] = useState(0);
  const historySignature = history
    .map((entry) => `${entry.id}:${entry.userType}:${entry.createdAt ?? ""}`)
    .join("|");
  const previousHistorySignatureRef = useRef(historySignature);
  // Burst/provider recovery shim: in strict proxy/self-hosted modes a late stream
  // failure can leave a persisted trailing user turn with no assistant reply. We
  // allow a one-time runtime remount per persisted turn so useChat can recover
  // without relying on a full page refresh.
  const forcedRehydrateKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (previousHistorySignatureRef.current !== historySignature) {
      previousHistorySignatureRef.current = historySignature;
      setRuntimeKey((current) => current + 1);
    }
  }, [historySignature]);

  return (
    <ConversationViewRuntime
      key={`${conversationId}:${runtimeKey}`}
      conversationId={conversationId}
      history={history}
      className={className}
      integrationAccountMap={integrationAccountMap}
      integrationFrontendMap={integrationFrontendMap}
      autoRegenerate={autoRegenerate}
      enableBurstSafeFirstReplyRecovery={enableBurstSafeFirstReplyRecovery}
      conversationStatus={conversationStatus}
      models={modelsProp}
      onForceRehydrate={(recoveryKey) => {
        if (forcedRehydrateKeyRef.current === recoveryKey) {
          return;
        }
        forcedRehydrateKeyRef.current = recoveryKey;
        setRuntimeKey((current) => current + 1);
      }}
    />
  );
}

interface ConversationViewRuntimeProps extends ConversationViewProps {
  onForceRehydrate?: (recoveryKey: string) => void;
}

function ConversationViewRuntime({
  conversationId,
  history,
  className,
  integrationAccountMap = {},
  integrationFrontendMap = {},
  autoRegenerate = false,
  enableBurstSafeFirstReplyRecovery = false,
  conversationStatus,
  models: modelsProp = [],
  onForceRehydrate,
}: ConversationViewRuntimeProps) {
  const readFetcher = useFetcher();
  const revalidator = useRevalidator();
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLDivElement>(null);
  const messageRefs = useRef<(HTMLDivElement | null)[]>([]);
  const autoRegeneratedConversationRef = useRef<string | null>(null);
  const autoRetryTimeoutRef = useRef<number | null>(null);
  const stalledTurnWatchdogRef = useRef<number | null>(null);
  const autoRetryAttemptRef = useRef(0);
  const regenerateRef = useRef<(() => void) | null>(null);
  const clearErrorRef = useRef<(() => void) | null>(null);
  const pendingUserTurnRef = useRef(false);
  const [autoRetryStatus, setAutoRetryStatus] = useState<{
    nextDelayMs: number | null;
    attempt: number;
    exhausted: boolean;
  }>({
    nextDelayMs: null,
    attempt: 0,
    exhausted: false,
  });
  // initialize to history.length so mount doesn't trigger the scroll effect
  const prevMessageCountRef = useRef(history.length);
  // spacer height = scroll container clientHeight so any message can scroll to top
  const [spacerHeight, setSpacerHeight] = useState(0);
  // keeps spacer alive after streaming ends until user scrolls back to bottom
  const [keepSpacer, setKeepSpacer] = useState(false);

  const defaultModelId = modelsProp.find((m) => m.isDefault)?.id ?? modelsProp[0]?.id;
  const [selectedModelId, setSelectedModelId] = useLocalCommonState<string | undefined>(
    "selectedModelId",
    defaultModelId,
  );
  // Ref so prepareSendMessagesRequest always reads the latest selection
  const selectedModelRef = useRef<string | undefined>(selectedModelId);
  selectedModelRef.current = selectedModelId;

  const handleModelChange = (modelId: string) => {
    setSelectedModelId(modelId);
  };

  const initialHistoryHasPendingUserTurn =
    history.length > 0 &&
    history[history.length - 1]?.userType !== UserTypeEnum.Agent;
  pendingUserTurnRef.current = initialHistoryHasPendingUserTurn;

  const scheduleAutoRetry = useCallback(() => {
    if (
      !enableBurstSafeFirstReplyRecovery ||
      !pendingUserTurnRef.current
    ) {
      return;
    }

    if (autoRetryTimeoutRef.current) {
      return;
    }

    const retryDelaysMs = [5000, 15000, 30000, 60000];
    const delayMs = retryDelaysMs[autoRetryAttemptRef.current];
    if (delayMs == null) {
      setAutoRetryStatus({
        nextDelayMs: null,
        attempt: autoRetryAttemptRef.current,
        exhausted: true,
      });
      return;
    }

    autoRetryAttemptRef.current += 1;
    setAutoRetryStatus({
      nextDelayMs: delayMs,
      attempt: autoRetryAttemptRef.current,
      exhausted: false,
    });

    if (autoRetryTimeoutRef.current) {
      window.clearTimeout(autoRetryTimeoutRef.current);
    }

    autoRetryTimeoutRef.current = window.setTimeout(() => {
      autoRetryTimeoutRef.current = null;
      setAutoRetryStatus({
        nextDelayMs: null,
        attempt: autoRetryAttemptRef.current,
        exhausted: false,
      });
      clearErrorRef.current?.();
      regenerateRef.current?.();
    }, delayMs);
  }, [enableBurstSafeFirstReplyRecovery]);
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
    clearError,
    stop,
    regenerate,
    addToolApprovalResponse,
  } = useChat({
    id: conversationId,
    resume: true,
    onFinish: () => {
      autoRetryAttemptRef.current = 0;
      setAutoRetryStatus({
        nextDelayMs: null,
        attempt: 0,
        exhausted: false,
      });
      if (autoRetryTimeoutRef.current) {
        window.clearTimeout(autoRetryTimeoutRef.current);
        autoRetryTimeoutRef.current = null;
      }
      toolArgOverridesRef.current = {};
      pendingApprovalRequestsRef.current = [];
      readFetcher.submit(null, {
        method: "GET",
        action: `/api/v1/conversation/${conversationId}/read`,
      });
    },
    onError: () => {
      scheduleAutoRetry();
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

        if (hasApprovals) {
          return {
            body: { messages, needsApproval: true, id, toolArgOverrides },
          };
        }

        return {
          body: {
            message: messages[messages.length - 1],
            id,
            toolArgOverrides,
            modelId: selectedModelRef.current,
          },
        };
      },
    }),
    // Fire when every suspended tool (across the full agent hierarchy) has a
    // recorded approve/decline decision in toolArgOverridesRef.
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithApprovalResponses,
  });
  regenerateRef.current = regenerate;
  clearErrorRef.current = clearError;
  const latestMessageIsUser =
    messages.length > 0 && messages[messages.length - 1]?.role === "user";
  pendingUserTurnRef.current = latestMessageIsUser;

  useEffect(() => {
    return () => {
      if (autoRetryTimeoutRef.current) {
        window.clearTimeout(autoRetryTimeoutRef.current);
      }
      if (stalledTurnWatchdogRef.current) {
        window.clearTimeout(stalledTurnWatchdogRef.current);
      }
    };
  }, []);

  useEffect(() => {
    // Burst/provider recovery shim: once a reply actually starts streaming again,
    // clear any pending retry timer but preserve the current attempt count so the
    // user-facing banner still reflects the in-flight recovery state.
    if (
      (status === "submitted" || status === "streaming") &&
      autoRetryTimeoutRef.current
    ) {
      window.clearTimeout(autoRetryTimeoutRef.current);
      autoRetryTimeoutRef.current = null;
      setAutoRetryStatus({
        nextDelayMs: null,
        attempt: autoRetryAttemptRef.current,
        exhausted: false,
      });
    }
  }, [status]);

  useEffect(() => {
    // Any completed assistant turn resets the retry/remount state for the next
    // pending user turn.
    if (!latestMessageIsUser) {
      autoRetryAttemptRef.current = 0;
      if (autoRetryTimeoutRef.current) {
        window.clearTimeout(autoRetryTimeoutRef.current);
        autoRetryTimeoutRef.current = null;
      }
      if (stalledTurnWatchdogRef.current) {
        window.clearTimeout(stalledTurnWatchdogRef.current);
        stalledTurnWatchdogRef.current = null;
      }
      setAutoRetryStatus({
        nextDelayMs: null,
        attempt: 0,
        exhausted: false,
      });
    }
  }, [latestMessageIsUser]);

  useEffect(() => {
    if (
      autoRegenerate &&
      initialHistoryHasPendingUserTurn &&
      conversationStatus !== "running"
    ) {
      const recoveryKey = `${conversationId}:${history[history.length - 1]?.id ?? "pending"}`;
      if (autoRegeneratedConversationRef.current === recoveryKey) {
        return;
      }
      autoRegeneratedConversationRef.current = recoveryKey;
      regenerate();
    }
  }, [
    autoRegenerate,
    conversationId,
    conversationStatus,
    history,
    initialHistoryHasPendingUserTurn,
    regenerate,
  ]);

  useEffect(() => {
    if (
      !enableBurstSafeFirstReplyRecovery ||
      !latestMessageIsUser ||
      status !== "error"
    ) {
      return;
    }

    clearError();
    scheduleAutoRetry();
  }, [
    clearError,
    enableBurstSafeFirstReplyRecovery,
    latestMessageIsUser,
    scheduleAutoRetry,
    status,
  ]);

  useEffect(() => {
    if (
      !enableBurstSafeFirstReplyRecovery ||
      !latestMessageIsUser ||
      status === "submitted" ||
      status === "streaming"
    ) {
      if (stalledTurnWatchdogRef.current) {
        window.clearTimeout(stalledTurnWatchdogRef.current);
        stalledTurnWatchdogRef.current = null;
      }
      return;
    }

    if (stalledTurnWatchdogRef.current || autoRetryTimeoutRef.current) {
      return;
    }

    // Transport resilience shim only: if a provider leaves us with a persisted
    // trailing user turn and no active stream, revalidate/remount once for that
    // turn so the existing chat flow can retry. This is not the normal chat UX.
    stalledTurnWatchdogRef.current = window.setTimeout(() => {
      stalledTurnWatchdogRef.current = null;
      const recoveryKey = `${conversationId}:${history[history.length - 1]?.id ?? "pending"}`;
      revalidator.revalidate();
      onForceRehydrate?.(recoveryKey);
    }, 2000);

    return () => {
      if (stalledTurnWatchdogRef.current) {
        window.clearTimeout(stalledTurnWatchdogRef.current);
        stalledTurnWatchdogRef.current = null;
      }
    };
  }, [
    clearError,
    enableBurstSafeFirstReplyRecovery,
    latestMessageIsUser,
    onForceRehydrate,
    revalidator,
    scheduleAutoRetry,
    status,
  ]);

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
          {messages.map((message: UIMessage, i: number) => (
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
          ))}
          {/* Spacer while streaming or until user scrolls back to bottom */}
          {(status === "streaming" || status === "submitted" || keepSpacer) && (
            <div style={{ height: spacerHeight, flexShrink: 0 }} />
          )}
          {enableBurstSafeFirstReplyRecovery &&
            latestMessageIsUser &&
            (autoRetryStatus.nextDelayMs !== null || autoRetryStatus.exhausted) && (
              <div className="text-muted-foreground px-4 pb-2 text-xs">
                {autoRetryStatus.nextDelayMs !== null
                  ? `Provider is rate-limiting the latest reply. Retrying automatically in ${Math.ceil(autoRetryStatus.nextDelayMs / 1000)}s (attempt ${autoRetryStatus.attempt}).`
                  : "Provider is still rate-limiting the latest reply. You can retry without refreshing."}
                {autoRetryStatus.exhausted && (
                  <button
                    type="button"
                    className="ml-2 underline underline-offset-2"
                    onClick={() => {
                      autoRetryAttemptRef.current = 0;
                      setAutoRetryStatus({
                        nextDelayMs: null,
                        attempt: 0,
                        exhausted: false,
                      });
                      clearErrorRef.current?.();
                      regenerateRef.current?.();
                    }}
                  >
                    Retry reply
                  </button>
                )}
              </div>
            )}
        </div>
      </div>

      <div className="flex w-full flex-col items-center">
        <div ref={composerRef} className="w-full max-w-[90ch] px-4">
          <ThinkingIndicator
            isLoading={status === "streaming" || status === "submitted"}
          />
          <ConversationTextarea
            className="bg-background-3 border-1 w-full border-gray-300"
            isLoading={status === "streaming" || status === "submitted" || conversationStatus === "running"}
            disabled={needsApproval || conversationStatus === "running"}
            onConversationCreated={(message) => {
              if (message) sendMessage({ text: message });
            }}
            stop={() => stop()}
            models={modelsProp}
            selectedModelId={selectedModelId}
            onModelChange={handleModelChange}
          />
        </div>
      </div>
    </div>
  );
}
