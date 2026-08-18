/**
 * Live conversation hook — the fire-and-forget replacement for `useChat`.
 *
 * Two moving parts:
 *   1. **Send.** `sendMessage(parts)` generates a uuid, optimistically
 *      inserts a user row, POSTs to the non-streaming message endpoint,
 *      and returns. The server persists the row, enqueues the owner's
 *      agent turn as a background job, and returns immediately. Every
 *      subsequent write (assistant reply, mention-driven specialist,
 *      chained turns) publishes to Redis and lands here via the
 *      subscription below — no per-turn SSE-blocked composer.
 *
 *   2. **Subscribe.** On mount we open an EventSource to
 *      `/api/v1/conversation/:id/subscribe`. Each event is a row-upsert
 *      envelope from `conversation-pubsub.server`. We debounce and
 *      refetch the full history — simple, robust across bursts, and
 *      dedup is trivial by row id. Optimize with a per-row endpoint
 *      later if bandwidth becomes a concern.
 *
 * Returned shape is deliberately close to useChat's so consumers can
 * migrate without gutting their render code — `messages`, `status`,
 * `sendMessage`, `stop`.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { UIMessage } from "ai";

/** Server-shape ConversationHistory row (matches the loader payload). */
interface HistoryRow {
  id: string;
  userType: string;
  message?: string;
  parts?: unknown[];
  createdAt?: string | Date;
  agentId?: string | null;
  status?: string | null;
  _optimistic?: boolean;
  _failed?: boolean;
}

export interface UseConversationLiveOptions {
  conversationId: string;
  /** Loader-provided initial history — the NEWEST page, not the whole
   *  thread. Seeds the UI so first paint has content while the
   *  EventSource is still connecting. */
  initialHistory: HistoryRow[];
  /** Whether rows exist above `initialHistory`. From the loader. */
  initialHasMore?: boolean;
  /** Keyset cursor for the page above `initialHistory`. From the loader. */
  initialCursor?: string | null;
  /** Fires when a new assistant row (from any agent) is observed on the
   *  live feed — useful for onboarding revalidation, TTS trigger, etc. */
  onAssistantMessage?: (row: HistoryRow) => void;
}

export interface UseConversationLiveResult {
  /** UIMessage-shaped view for rendering (same as useChat returns). */
  messages: UIMessage[];
  /** Raw history rows in the same order, for anything that needs
   *  server-side metadata (agentId, status). Indices align with
   *  `messages`. */
  historyRows: HistoryRow[];
  /** True when a POST is in flight OR when any row has status="working"
   *  (an agent turn is still running server-side). */
  isBusy: boolean;
  /** Slack-simple "busy" — a boolean for the composer to flip its
   *  spinner. Distinct from useChat's `status` string; consumers just
   *  need the boolean anyway. */
  status: "idle" | "sending" | "working";
  /** Fire a user message. Returns as soon as the POST comes back. */
  sendMessage: (parts: unknown[]) => Promise<void>;
  /** Convenience: send a plain-text message. Matches the shape
   *  `useChatContext.sendMessage(text)` was passing around. */
  sendText: (text: string) => Promise<void>;
  /** No-op today — kept so consumers that call `stop()` from useChat
   *  don't need to be modified. Server-side cancel-on-re-mention is
   *  where real cancellation now lives. */
  stop: () => void;
  /** True while an older page is being fetched. */
  isLoadingOlder: boolean;
  /** Whether any rows remain above the oldest one currently loaded. */
  hasMore: boolean;
  /** Prepend the next page of older rows. No-op when already loading or
   *  when the top of the thread is reached. Resolves once state is
   *  updated so the caller can restore scroll position. */
  loadOlder: () => Promise<void>;
}

/** Debounce window for coalescing SSE bursts into a single refetch.
 *  Small enough that the UI feels live, big enough to batch a chain of
 *  writes (owner turn done → dispatchMentions publishes → placeholder
 *  landed → status flipped) into one round-trip. */
const REFETCH_DEBOUNCE_MS = 120;

/** Fallback poll interval. SSE is the primary sync channel; this only
 *  matters when the SSE silently fails (browser tab throttling, proxy
 *  drop without RST, pubsub misconfig). Cheap enough that leaving it on
 *  is fine — a single GET per interval, dedup'd against rows we already
 *  have. Tune down if noisy in prod. */
const FALLBACK_POLL_MS = 8_000;

export function useConversationLive(
  opts: UseConversationLiveOptions,
): UseConversationLiveResult {
  const {
    conversationId,
    initialHistory,
    initialHasMore = false,
    initialCursor = null,
    onAssistantMessage,
  } = opts;

  const [rows, setRows] = useState<HistoryRow[]>(initialHistory ?? []);
  const [pendingCount, setPendingCount] = useState(0);
  const [hasMore, setHasMore] = useState(initialHasMore);
  const [isLoadingOlder, setIsLoadingOlder] = useState(false);
  // Cursor for the next page UP. Held in a ref (not state) so the
  // in-flight guard below reads the current value without re-creating
  // `loadOlder` on every page.
  const cursorRef = useRef<string | null>(initialCursor);
  const loadingOlderRef = useRef(false);
  const seenRowIdsRef = useRef<Set<string>>(
    new Set(initialHistory?.map((r) => r.id) ?? []),
  );
  const onAssistantMessageRef = useRef(onAssistantMessage);
  useEffect(() => {
    onAssistantMessageRef.current = onAssistantMessage;
  }, [onAssistantMessage]);

  const refetch = useCallback(async () => {
    try {
      const res = await fetch(`/api/v1/conversation/${conversationId}`);
      if (!res.ok) return;
      const data = (await res.json()) as {
        ConversationHistory?: HistoryRow[];
      };
      const nextRows = data.ConversationHistory ?? [];
      setRows((prev) => {
        // Merge by id — never replace the array. The response only covers
        // the NEWEST page, so a wholesale swap would silently discard any
        // older pages the user had scrolled back to (and, before
        // pagination, it's what let optimistic rows survive: they carry
        // the same client-generated id the server persists, so they're
        // overwritten in place rather than duplicated).
        const indexById = new Map<string, number>();
        prev.forEach((r, i) => indexById.set(r.id, i));
        const merged = prev.slice();
        for (const row of nextRows) {
          const at = indexById.get(row.id);
          if (at === undefined) merged.push(row);
          else merged[at] = row;
        }
        return merged;
      });
      // Fire onAssistantMessage for each newly-observed agent row.
      const cb = onAssistantMessageRef.current;
      if (cb) {
        for (const row of nextRows) {
          if (
            !seenRowIdsRef.current.has(row.id) &&
            row.userType === "Agent"
          ) {
            cb(row);
          }
        }
      }
      for (const row of nextRows) seenRowIdsRef.current.add(row.id);
    } catch (err) {
      console.warn("conversation refetch failed", err);
    }
  }, [conversationId]);

  // SSE subscription + debounced refetch on any row event. Also refetches
  // on every `onopen` — including reconnects after a network blip — so
  // events published during the disconnected window (which Redis pub/sub
  // doesn't retain) aren't lost. Fallback poll every FALLBACK_POLL_MS
  // catches the "SSE silently died in a way that doesn't fire onopen or
  // onerror" case (browser tab throttled, proxy dropped without RST, etc).
  useEffect(() => {
    let cancelled = false;
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    let fallbackPoll: ReturnType<typeof setInterval> | null = null;
    const scheduleRefetch = () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        if (!cancelled) void refetch();
      }, REFETCH_DEBOUNCE_MS);
    };

    const es = new EventSource(
      `/api/v1/conversation/${conversationId}/subscribe`,
    );
    es.onopen = () => {
      // Includes the very first connect + every reconnect. Refetch so
      // we catch up on any events missed during a disconnected window.
      console.debug("[conv-live] SSE open, refetching");
      scheduleRefetch();
    };
    es.onmessage = (evt) => {
      console.debug("[conv-live] SSE event", evt.data?.slice?.(0, 100));
      scheduleRefetch();
    };
    es.onerror = (err) => {
      console.debug("[conv-live] SSE error (will auto-reconnect)", err);
    };
    // Belt-and-suspenders periodic refetch. Cheap (single GET), and
    // guarantees state converges even if SSE silently stops working.
    fallbackPoll = setInterval(() => {
      if (!cancelled) void refetch();
    }, FALLBACK_POLL_MS);

    return () => {
      cancelled = true;
      if (debounceTimer) clearTimeout(debounceTimer);
      if (fallbackPoll) clearInterval(fallbackPoll);
      es.close();
    };
  }, [conversationId, refetch]);

  /**
   * Walk one page up the thread. The cursor is owned entirely by this
   * function — `refetch` must never touch it, since refetch always reads
   * the newest page and would rewind the cursor back down to the bottom,
   * making every subsequent "load older" re-fetch pages already prepended.
   */
  const loadOlder = useCallback(async () => {
    if (loadingOlderRef.current) return;
    const cursor = cursorRef.current;
    if (!cursor) return;

    loadingOlderRef.current = true;
    setIsLoadingOlder(true);
    try {
      const res = await fetch(
        `/api/v1/conversation/${conversationId}?before=${encodeURIComponent(cursor)}`,
      );
      if (!res.ok) return;
      const data = (await res.json()) as {
        ConversationHistory?: HistoryRow[];
        hasMore?: boolean;
        nextCursor?: string | null;
      };
      const older = data.ConversationHistory ?? [];
      cursorRef.current = data.nextCursor ?? null;
      setHasMore(!!data.hasMore);

      if (older.length > 0) {
        setRows((prev) => {
          // Dedup defensively: a row written between the loader snapshot
          // and this request can straddle the cursor boundary.
          const known = new Set(prev.map((r) => r.id));
          const fresh = older.filter((r) => !known.has(r.id));
          return fresh.length > 0 ? [...fresh, ...prev] : prev;
        });
      }
    } catch (err) {
      console.warn("conversation loadOlder failed", err);
    } finally {
      loadingOlderRef.current = false;
      setIsLoadingOlder(false);
    }
  }, [conversationId]);

  const sendMessage = useCallback(
    async (parts: unknown[]) => {
      const id =
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `client-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const optimistic: HistoryRow = {
        id,
        userType: "User",
        parts,
        createdAt: new Date(),
        _optimistic: true,
      };
      setRows((prev) => [...prev, optimistic]);
      setPendingCount((c) => c + 1);
      try {
        const res = await fetch(
          `/api/v1/conversation/${conversationId}/message`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id, parts }),
          },
        );
        if (!res.ok) {
          throw new Error(`send failed: ${res.status}`);
        }
        // Server confirmed. The SSE will echo the persisted row and the
        // refetch will replace this optimistic row by id.
      } catch (err) {
        console.error("send message failed", err);
        setRows((prev) =>
          prev.map((r) => (r.id === id ? { ...r, _failed: true } : r)),
        );
      } finally {
        setPendingCount((c) => Math.max(0, c - 1));
      }
    },
    [conversationId],
  );

  const sendText = useCallback(
    (text: string) => sendMessage([{ type: "text", text }]),
    [sendMessage],
  );

  const stop = useCallback(() => {
    // No-op. Cancel-on-re-mention on the server side handles the
    // meaningful cancellation semantics; there's no in-flight stream
    // here to cut.
  }, []);

  const anyWorking = useMemo(
    () => rows.some((r) => r.status === "working"),
    [rows],
  );

  const status: UseConversationLiveResult["status"] = pendingCount > 0
    ? "sending"
    : anyWorking
      ? "working"
      : "idle";

  const messages = useMemo<UIMessage[]>(() => {
    return rows.map((row) => {
      const role: "user" | "assistant" | "system" =
        row.userType === "Agent" ? "assistant" : "user";
      const parts = (Array.isArray(row.parts) ? row.parts : [
        { type: "text", text: row.message ?? "" },
      ]) as UIMessage["parts"];
      // Cast is fine — UIMessage is a discriminated union we don't
      // reconstruct fully. Consumers only read `role` and `parts`.
      return {
        id: row.id,
        role,
        parts,
      } as unknown as UIMessage;
    });
  }, [rows]);

  return {
    messages,
    historyRows: rows,
    isBusy: pendingCount > 0 || anyWorking,
    status,
    sendMessage,
    sendText,
    stop,
    isLoadingOlder,
    hasMore,
    loadOlder,
  };
}
