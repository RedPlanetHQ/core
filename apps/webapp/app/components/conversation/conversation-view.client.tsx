import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useFetcher } from "@remix-run/react";
import { useLocalCommonState } from "~/hooks/use-local-state";
import { type UIMessage } from "ai";
import { useConversationLive } from "~/hooks/use-conversation-live";
import { UserTypeEnum } from "@core/types";
import {
  ConversationItem,
  type ConversationItemSender,
} from "./conversation-item.client";
import {
  ConversationTextarea,
  type ChatAttachment,
  type LLMModel,
} from "./conversation-textarea.client";
import {
  collectApprovalRequests,
  conversationDayKey,
  formatConversationDayLabel,
  hasNeedsApprovalDeep,
  mergeAgentParts,
  type ConversationToolPart,
} from "./conversation-utils";
import { ChatContextProvider } from "./chat-context";
import {
  PermissionModeSelector,
  type PermissionMode,
} from "./permission-mode-selector.client";
import { cn } from "~/lib/utils";
import { useStreamingTTS } from "~/hooks/use-streaming-tts";
import { useOptionalUser } from "~/hooks/useUser";

interface ConversationHistory {
  id: string;
  userType: string;
  message: string;
  parts: any;
  createdAt?: string | Date;
  /** Which agent authored this row (assistant messages only). Used to
   *  render the correct name + avatar in the Slack-style item header. */
  agentId?: string | null;
}

/** Agent record shape used for per-message sender attribution. Loader
 *  passes this in via `colleagues`; ConversationView builds an id-keyed
 *  map from it and hands each ConversationItem its resolved author. */
export interface AgentBadge {
  id: string;
  handle: string;
  displayName: string;
  appearance?: {
    eye?: string;
    eyeColor?: string;
    accentColor?: string;
  } | null;
}

interface ConversationViewProps {
  conversationId: string;
  /** The NEWEST page of history from the loader, not the whole thread. */
  history: ConversationHistory[];
  /** Whether older rows exist above `history`. Drives the load-on-scroll
   *  sentinel; omit (or false) to disable paging for this surface. */
  hasMore?: boolean;
  /** Keyset cursor for the page above `history`. */
  nextCursor?: string | null;
  className?: string;
  integrationAccountMap?: Record<string, string>;
  integrationFrontendMap?: Record<string, string>;
  /** When true, auto-triggers regenerate if history has only 1 message */
  autoRegenerate?: boolean;
  /** DB conversation status — input is disabled when "running" */
  conversationStatus?: string;
  models?: LLMModel[];
  /** Active workspace agents. Used both for the composer's `@` mention
   *  picker (handle + displayName only) AND for per-message sender
   *  attribution in the Slack-style item header (needs id + appearance).
   *  Include every agent that might have authored a message in this
   *  thread, not just the ones you want mentioned. */
  colleagues?: AgentBadge[];
  /** Enable the @-mention picker. Only meaningful in task-scoped
   *  conversations (collaboration doesn't route in 1:1 chats). */
  enableMentionPicker?: boolean;
  /** Optional starter text seeded into the composer on mount. Used by
   *  entry points that deep-link a specific ask ("Add Task" from the
   *  command bar, etc.). One-shot — the editor takes it as initial
   *  content and the user edits from there. */
  defaultMessage?: string;
  /** When true, hide the very first user message from the rendered chat
   *  while still keeping it in history (so the agent sees it). Used by
   *  onboarding to keep the hidden seed instruction out of the UI. */
  hideFirstUserMessage?: boolean;
  /** Optional callback fired after each streamed turn finishes. The
   *  onboarding page uses this to revalidate the loader — if the agent
   *  has called complete_onboarding, the next loader run sees the flag
   *  and redirects to /home/daily. */
  onStreamComplete?: () => void;
  /** Initial voice mode on mount — typically driven by the `?voice=1`
   *  URL search param so the state carries through the
   *  ConversationNew → create → redirect flow. */
  initialVoiceMode?: boolean;
}

export function ConversationView({
  conversationId,
  history: historyProp,
  hasMore: hasMoreProp = false,
  nextCursor = null,
  className,
  integrationAccountMap = {},
  integrationFrontendMap = {},
  autoRegenerate = false,
  conversationStatus: conversationStatusProp,
  models: modelsProp = [],
  colleagues = [],
  enableMentionPicker = false,
  defaultMessage,
  hideFirstUserMessage = false,
  onStreamComplete,
  initialVoiceMode = false,
}: ConversationViewProps) {
  const currentUser = useOptionalUser();
  // BYOK workspaces pay their own provider bills, so the credit balance
  // is irrelevant to them — server-side hasCredits also bypasses BYOK,
  // so disabling here would be a lie.
  const outOfCredits =
    !!currentUser &&
    (currentUser.availableCredits ?? 0) < 1 &&
    !currentUser.hasBYOK;

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
  const contentRef = useRef<HTMLDivElement>(null);
  const messageRefs = useRef<(HTMLDivElement | null)[]>([]);
  const topSentinelRef = useRef<HTMLDivElement>(null);
  // Identity of the newest row, not a count — a prepend from "load older"
  // also grows the count, and keying the scroll-into-view effect off the
  // count would yank the viewport back down every time an older page lands.
  const prevLastRowIdRef = useRef<string | undefined>(
    history[history.length - 1]?.id,
  );
  // Distance from the bottom of the scroll content, captured just before an
  // older page is prepended and restored right after it commits. Anchoring
  // on the bottom rather than the top is what keeps the viewport still
  // while content is inserted above it.
  const pendingAnchorRef = useRef<number | null>(null);
  // Viewport height of the scroll container, and the measured height of the
  // in-flight turn (last user message → end of the reply). The spacer is the
  // difference: just enough pad to float the user's question to the top while
  // the answer streams, and nothing once the turn outgrows the viewport.
  const [containerHeight, setContainerHeight] = useState(0);
  const [lastTurnHeight, setLastTurnHeight] = useState(0);
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

  // Voice mode lives in ConversationView (not the textarea) so the
  // server-bound chat transport can flip the request mode and the
  // streaming-TTS hook can read the same flag.
  const [voiceMode, setVoiceMode] = useState(initialVoiceMode);
  const voiceModeRef = useRef(voiceMode);
  voiceModeRef.current = voiceMode;

  const handleModelChange = (modelId: string) => {
    setSelectedModelId(modelId);
  };

  // Stop / cancel-in-flight was removed with the fire-and-forget
  // migration. Composer never locks on a pending reply — user can just
  // send another message; cancel-on-re-mention on the server handles
  // "actually do Y instead" for owner/specialist re-mentions.

  // Live conversation hook — POST to send + Redis-pubsub SSE for updates.
  // Consumers that used to lean on useChat internals (regenerate, tool
  // approvals, permission mode) either have a no-op shim below or are
  // just dropped since the underlying flow doesn't need them anymore.
  const {
    messages,
    historyRows,
    status: liveStatus,
    sendMessage: sendMessageParts,
    sendText,
    stop,
    hasMore,
    isLoadingOlder,
    loadOlder,
  } = useConversationLive({
    conversationId,
    initialHistory: history as unknown as Parameters<
      typeof useConversationLive
    >[0]["initialHistory"],
    initialHasMore: hasMoreProp,
    initialCursor: nextCursor,
    onAssistantMessage: () => {
      setConversationStatus("completed");
      readFetcher.submit(null, {
        method: "GET",
        action: `/api/v1/conversation/${conversationId}/read`,
      });
      onStreamComplete?.();
    },
  });
  // useConversationLive returns a boolean-ish status; the render code was
  // written against useChat's string enum. Map to a compatible shape so
  // downstream `status === "streaming"` checks keep working without a
  // sweep of the JSX.
  const status: "ready" | "submitted" | "streaming" =
    liveStatus === "sending"
      ? "submitted"
      : liveStatus === "working"
        ? "streaming"
        : "ready";

  // useChat's sendMessage took { role, parts } — new API takes just parts.
  // Wrapper preserves the old signature so composer callbacks don't need
  // to change.
  const sendMessage = useCallback(
    (input: { role?: string; parts: unknown[] } | string) => {
      if (typeof input === "string") return sendText(input);
      return sendMessageParts(input.parts);
    },
    [sendMessageParts, sendText],
  );

  void stop;

  // Auto-fire the initial regenerate when we land on a conversation that
  // only has the seed user message. `sendAutomaticallyWhen` from the AI
  // SDK doesn't help here — it's only consulted after another chat action
  // completes (approval response, tool output, end of stream), never on
  // mount. React 18 StrictMode also double-mounts effects in dev, so a
  // plain useEffect fires regenerate() twice. The ref guard makes it
  // idempotent without rejecting the second StrictMode pass via
  // unmount-cleanup tricks.
  const autoRegenerateFiredRef = useRef(false);
  useEffect(() => {
    if (autoRegenerateFiredRef.current) return;
    if (
      autoRegenerate &&
      history.length === 1 &&
      conversationStatus !== "running"
    ) {
      autoRegenerateFiredRef.current = true;
      // useChat had a native `regenerate()` that re-fired the last turn.
      // The new flow doesn't need it — the seed user message is already
      // in history, and if the owner hasn't replied yet, the SSE will
      // deliver it whenever the background job wraps. If we ever need to
      // manually kick the owner from the client, POST to the message
      // endpoint with the existing seed row id (no-op upsert + fresh
      // enqueue). Currently no path needs that.
    }
  }, []);

  // Index of the message that opened the current turn. The spacer only ever
  // exists to lift *that* message to the top of the viewport, so with no user
  // message in the thread (a bare agent greeting) there is nothing to lift
  // and no pad is warranted.
  const lastUserIndex = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      // A hidden seed message has no DOM node to measure against.
      if (hideFirstUserMessage && i === 0) continue;
      if (messages[i].role === "user") return i;
    }
    return -1;
  }, [messages, hideFirstUserMessage]);

  // Track the scroll container's viewport height.
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    const update = () => setContainerHeight(container.clientHeight);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(container);
    return () => ro.disconnect();
  }, []);

  // Measure the current turn: top of the last user message → bottom of the
  // last rendered message. Deliberately measured off the message elements
  // rather than the content column, since the column also contains the
  // spacer we're sizing (that would be circular).
  useEffect(() => {
    const content = contentRef.current;
    if (!content) return;

    let frame = 0;
    const measure = () => {
      frame = 0;
      if (lastUserIndex < 0) {
        setLastTurnHeight(0);
        return;
      }
      const first = messageRefs.current[lastUserIndex];
      const last = messageRefs.current[messages.length - 1];
      if (!first || !last) return;
      const height =
        last.getBoundingClientRect().bottom -
        first.getBoundingClientRect().top;
      setLastTurnHeight(height);
    };

    measure();
    // Re-measure as the reply streams in and the turn grows.
    const ro = new ResizeObserver(() => {
      if (frame) return;
      frame = requestAnimationFrame(measure);
    });
    ro.observe(content);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      ro.disconnect();
    };
  }, [lastUserIndex, messages.length]);

  const spacerHeight =
    lastUserIndex < 0 ? 0 : Math.max(0, containerHeight - lastTurnHeight);

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

  // Collapse the spacer as soon as the turn finishes. Without this it
  // survives until the user happens to scroll to the bottom, leaving a
  // screen-high void under the last reply that you can scroll into.
  useEffect(() => {
    if (status === "ready") setKeepSpacer(false);
  }, [status]);

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

  // Ask for the next page up when the sentinel above the first message
  // scrolls into view. rootMargin starts the fetch a screenful early so the
  // rows are usually in place before the user reaches the top.
  const handleLoadOlder = useCallback(() => {
    const container = scrollContainerRef.current;
    if (container) {
      pendingAnchorRef.current = container.scrollHeight - container.scrollTop;
    }
    void loadOlder();
  }, [loadOlder]);

  useEffect(() => {
    const sentinel = topSentinelRef.current;
    const container = scrollContainerRef.current;
    if (!sentinel || !container || !hasMore) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) handleLoadOlder();
      },
      { root: container, rootMargin: "400px 0px 0px 0px" },
    );
    io.observe(sentinel);
    return () => io.disconnect();
  }, [hasMore, handleLoadOlder]);

  // Restore the scroll position after a prepend commits. Keyed on the id of
  // the topmost row — that changes exactly when older rows land, and never
  // when a new message arrives at the bottom.
  const topRowId = historyRows[0]?.id;
  useLayoutEffect(() => {
    const anchor = pendingAnchorRef.current;
    if (anchor === null) return;
    pendingAnchorRef.current = null;
    const container = scrollContainerRef.current;
    if (container) container.scrollTop = container.scrollHeight - anchor;
  }, [topRowId]);

  // When a new user message is added, force-scroll it to the top of the container
  useEffect(() => {
    const newCount = messages.length;
    const lastRowId = messages[newCount - 1]?.id;
    if (lastRowId && lastRowId !== prevLastRowIdRef.current) {
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
    prevLastRowIdRef.current = lastRowId;
  }, [messages]);

  const lastAssistant = useMemo(
    () =>
      [...messages].reverse().find((m) => m.role === "assistant") as
        | UIMessage
        | undefined,
    [messages],
  );

  // Accumulated plain-text rendering of the latest assistant message
  // — feeds the streaming TTS hook so each completed sentence can be
  // spoken as the model emits it.
  const lastAssistantText = useMemo(
    () =>
      lastAssistant ? extractAssistantText(lastAssistant.parts as any[]) : "",
    [lastAssistant],
  );
  const isChatStreaming = status === "streaming" || status === "submitted";
  const tts = useStreamingTTS({
    enabled: voiceMode,
    text: lastAssistantText,
    isStreaming: isChatStreaming,
  });

  // VAD → TTS barge-in wiring. Duck the moment we hear audio; restore
  // if the turn turned out to be noise (ElevenLabs `(background music)`
  // / `(wind)` events); flush when it was real speech so the next
  // assistant reply doesn't overlap the last one.
  const handleVoiceSpeechOnset = useCallback(() => {
    tts.duck();
  }, [tts]);
  const handleVoiceTurnResult = useCallback(
    ({ text }: { text: string; containedEvents: boolean }) => {
      if (text) {
        tts.flush();
      } else {
        tts.restore();
      }
    },
    [tts],
  );

  // Tool-approval scaffolding removed with the useChat migration —
  // ask_user is gone and requireApproval integrations no longer pause
  // for a UI click. `needsApproval` is stubbed to false so downstream
  // props (composer's disabled=needsApproval) never gate on it.
  const needsApproval = false;
  // Legacy imports kept in scope purely to avoid an import-diff churn.
  // TODO(cleanup): drop these imports + the whole conversation-utils
  // approval helpers in the next tool-item pass.
  void hasNeedsApprovalDeep;
  void collectApprovalRequests;
  void mergeAgentParts;

  // Id-keyed lookup for per-message sender attribution. Recomputes only
  // when the colleagues roster identity changes — negligible cost.
  const agentBadgeById = useMemo(() => {
    const map = new Map<string, AgentBadge>();
    for (const a of colleagues) {
      if (a.id) map.set(a.id, a);
    }
    return map;
  }, [colleagues]);

  // Flattened render list: date dividers interleaved with messages as
  // first-class items rather than decorations hung off a message. That's
  // what lets a windowing library measure and recycle them later — a
  // divider is just another row with a height.
  //
  // Each message item carries its ORIGINAL index into `messages`, because
  // `messageRefs`, `historyRows` and the spacer measurement are all keyed
  // by that index. Only the render order is flattened; the index space is
  // untouched.
  const renderItems = useMemo(() => {
    const items: Array<
      | { kind: "divider"; key: string; label: string }
      | { kind: "message"; key: string; index: number }
    > = [];
    let lastDayKey: string | null = null;

    for (let i = 0; i < messages.length; i++) {
      // Onboarding: the very first user message is a seed instruction we
      // keep in history (so the agent sees it) but don't render.
      if (hideFirstUserMessage && i === 0 && messages[i].role === "user") {
        continue;
      }
      const createdAt = historyRows[i]?.createdAt;
      if (createdAt) {
        const dayKey = conversationDayKey(createdAt);
        if (dayKey !== lastDayKey) {
          items.push({
            kind: "divider",
            key: `day-${dayKey}`,
            label: formatConversationDayLabel(createdAt),
          });
          lastDayKey = dayKey;
        }
      }
      items.push({
        kind: "message",
        // Row id, not array index — a prepend from "load older" shifts
        // every index, and index keys would remount the whole thread.
        key: messages[i].id ?? `msg-${i}`,
        index: i,
      });
    }
    return items;
  }, [messages, historyRows, hideFirstUserMessage]);

  // Nested tool renderers (e.g. suggest_integrations cards) fire a
  // programmatic user turn via ChatContext without knowing the internal
  // parts shape — this is a thin wrapper that awaits nothing.
  const sendTextMessage = useCallback(
    (text: string) => {
      void sendText(text);
    },
    [sendText],
  );

  return (
    <ChatContextProvider sendMessage={sendTextMessage}>
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
          {/* mt-auto: a thread shorter than the viewport hugs the composer
              instead of hanging at the top with dead space beneath it. Once
              content overflows there's no free space and mt-auto is inert. */}
          <div
            ref={contentRef}
            className="mt-auto flex w-full max-w-[90ch] flex-col pb-4"
          >
            {/* Top-of-thread sentinel. Kept mounted (not swapped for the
                loading row) so the observer target doesn't churn between
                pages. */}
            {hasMore && (
              <div ref={topSentinelRef} className="h-px w-full shrink-0" />
            )}
            {isLoadingOlder && (
              <div className="text-muted-foreground py-3 text-center text-xs">
                Loading earlier messages…
              </div>
            )}
            {renderItems.map((item) => {
              if (item.kind === "divider") {
                return (
                  <div
                    key={item.key}
                    className="sticky top-0 z-10 flex justify-center py-2"
                  >
                    {/* Opaque background (the chat surface is bg-background-2)
                        so messages scrolling underneath don't bleed through
                        the sticky chip. All theme tokens — inverts with dark
                        mode for free. */}
                    <span className="bg-background-3 text-muted-foreground border-border flex h-5 items-center rounded border px-1.5 text-xs">
                      {item.label}
                    </span>
                  </div>
                );
              }

              const i = item.index;
              const message = messages[i];
              // Resolve the sender for the item header (Slack-style
              // "avatar + name" above every message). User messages use
              // the current user; agent messages resolve by agentId
              // against the workspace roster. Falls back to a generic
              // "Assistant" label when neither is available (legacy rows
              // written before we started stamping agentId).
              //
              // Read from `historyRows` (live), not `history` (loader
              // snapshot) — otherwise any assistant row that arrives via
              // SSE after mount has no agentId lookup and falls through
              // to the generic "Assistant" avatar. When the row has no
              // agentId (legacy write), fall back to the sole colleague
              // if there is exactly one — every non-task conversation is
              // scoped to a single agent.
              const liveRow = historyRows[i];
              const rawAgentId =
                liveRow?.agentId ??
                (colleagues.length === 1 ? colleagues[0].id : null);
              const sender: ConversationItemSender =
                message.role === "user"
                  ? {
                      kind: "user",
                      name:
                        currentUser?.displayName ??
                        currentUser?.name ??
                        currentUser?.email ??
                        "You",
                    }
                  : rawAgentId && agentBadgeById.has(rawAgentId)
                    ? {
                        kind: "agent",
                        name: agentBadgeById.get(rawAgentId)!.displayName,
                        appearance:
                          agentBadgeById.get(rawAgentId)!.appearance ?? null,
                      }
                    : { kind: "agent", name: "Assistant", appearance: null };
              return (
                <div
                  key={item.key}
                  ref={(el) => {
                    messageRefs.current[i] = el;
                  }}
                >
                  <ConversationItem
                    message={message}
                    // `historyRows` only — the loader `history` snapshot is
                    // just the newest page, so its indices stop lining up
                    // the moment an older page is prepended.
                    createdAt={liveRow?.createdAt}
                    sender={sender}
                    integrationAccountMap={integrationAccountMap}
                    integrationFrontendMap={integrationFrontendMap}
                  />
                </div>
              );
            })}
            {/* Spacer while streaming or until user scrolls back to bottom.
                Height is what's left of the viewport after the current turn,
                so it shrinks to nothing as the reply grows past one screen. */}
            {spacerHeight > 0 &&
              (status === "streaming" ||
                status === "submitted" ||
                keepSpacer) && (
                <div style={{ height: spacerHeight, flexShrink: 0 }} />
              )}
          </div>
        </div>

        <div className="flex w-full shrink-0 flex-col items-center">
          <div ref={composerRef} className="w-full max-w-[90ch] px-4">
            {/* ThinkingIndicator ("Coordinating…") removed — placeholder
                rows in the timeline (status="working") already show which
                agent is thinking, per-row, and the global banner just
                added redundant noise above them. */}
            <ConversationTextarea
              className="pt-4"
              colleagues={colleagues}
              enableMentionPicker={enableMentionPicker}
              defaultValue={defaultMessage}
              disabled={outOfCredits}
              placeholder={
                outOfCredits
                  ? "You're out of credits — top up to keep chatting"
                  : undefined
              }
              onConversationCreated={(message, attachments) => {
                const hasAttachments = (attachments?.length ?? 0) > 0;
                if (!message && !hasAttachments) return;
                if (hasAttachments) {
                  const parts: Array<Record<string, unknown>> = [];
                  if (message) parts.push({ type: "text", text: message });
                  for (const a of attachments as ChatAttachment[]) {
                    parts.push({
                      type: "file",
                      url: a.url,
                      mediaType: a.mediaType,
                      filename: a.filename,
                    });
                  }
                  sendMessage({ role: "user", parts: parts as any });
                } else {
                  sendMessage(message);
                }
              }}
              models={modelsProp}
              selectedModelId={selectedModelId}
              onModelChange={handleModelChange}
              skills={skillsFetcher.data?.skills}
              voiceMode={voiceMode}
              onVoiceModeChange={setVoiceMode}
              onVoiceSpeechOnset={handleVoiceSpeechOnset}
              onVoiceTurnResult={handleVoiceTurnResult}
              rightActions={
                // PermissionModeSelector gated tool-approval behavior;
                // approvals were removed alongside the useChat migration
                // so the selector has no meaning anymore. Leaving the
                // right-actions slot empty for now — reintroduce if a
                // future gate needs a global toggle.
                <span
                  className="hidden"
                  aria-hidden
                  data-permission-mode-legacy
                />
              }
            />
          </div>
        </div>
      </div>
    </ChatContextProvider>
  );
}

/**
 * Walk an assistant UIMessage's parts and concatenate every plain
 * text fragment. Tool-call parts and other non-text shapes are
 * skipped so the TTS hook only speaks the human-facing prose.
 */
function extractAssistantText(parts: unknown[] | undefined): string {
  if (!Array.isArray(parts)) return "";
  let out = "";
  for (const p of parts) {
    if (!p || typeof p !== "object") continue;
    const part = p as { type?: string; text?: unknown };
    if (part.type === "text" && typeof part.text === "string") {
      out += part.text;
    }
  }
  return out;
}
