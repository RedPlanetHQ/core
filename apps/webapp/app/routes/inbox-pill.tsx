/**
 * Inbox pill — Tauri-only floating badge that surfaces unread
 * VoiceInboxMessage rows.
 *
 * Visual: mirrors the voice-widget pill (FlickeringGrid + tiny status
 * label, h-7, rounded-lg, top-right of the window). Positioned in
 * top-right of the active screen by the Rust side on every show, and
 * kept there by the shared `voice:active-screen-changed` follower.
 *
 * Lifecycle (driven entirely from the webview, using session cookies
 * shared with the main window so we don't have to plumb a PAT through
 * Rust):
 *
 *   1. Poll `/api/v1/inbox?limit=20` on a steady interval.
 *   2. count → 0  → call `inbox_hide_panel`.
 *   3. count > 0 → call `inbox_position_top_right` + `inbox_show_panel`,
 *      render the badge.
 *   4. User clicks the pill → state flips to "Summarising…"; POST to
 *      `/api/v1/inbox/summarise` (mode=voice). The server runs the
 *      summariser, deletes the rows, returns `{ summary }`.
 *   5. We invoke `voice_speak(summary)` on the local Swift helper. A
 *      stop button replaces the badge while speaking; clicking it
 *      calls `voice_cancel_speech` and hides the pill.
 *   6. When TTS finishes (Swift emits `voice:tts-ended`) we hide too.
 */

import { useEffect, useRef, useState } from "react";
import {
  json,
  type LoaderFunctionArgs,
  type MetaFunction,
} from "@remix-run/node";
import { Square } from "lucide-react";
import { Theme, useTheme } from "remix-themes";

import { FlickeringGrid } from "~/components/ui/flickering-grid";
import { isTauri, tauriInvoke, tauriListen } from "~/lib/tauri.client";
import { cn } from "~/lib/utils";

export const meta: MetaFunction = () => [{ title: "Inbox" }];

export const loader = (_args: LoaderFunctionArgs) => json({});

type PillStatus = "idle" | "summarising" | "speaking" | "error";

interface InboxResponse {
  count: number;
  items: Array<{
    id: string;
    message: string;
    taskId: string | null;
    channelType: string | null;
    createdAt: string;
  }>;
}

interface SummariseResponse {
  summary: string;
  count: number;
}

const POLL_INTERVAL_MS = 10_000;

export default function InboxPill() {
  const [count, setCount] = useState(0);
  const [status, setStatus] = useState<PillStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [theme] = useTheme();
  const isDark = theme === Theme.DARK;

  const visibleRef = useRef(false);
  const busyRef = useRef(false);
  // Tracks the lifecycle of *our* speech so a stray `voice:tts-ended`
  // (from the main window's streaming TTS, a previous cancel, or a
  // racy Swift didCancel) doesn't hide the pill mid-speech.
  //
  //   "none"    — nothing in flight from us
  //   "pending" — voice_speak invoked, haven't heard our tts-started yet
  //   "playing" — our tts-started arrived; the *next* tts-ended is ours
  const speakPhaseRef = useRef<"none" | "pending" | "playing">("none");

  // Strip the host body backgrounds so the rounded pill has no frame.
  useEffect(() => {
    if (typeof document === "undefined") return;
    const prevHtmlBg = document.documentElement.style.background;
    const prevBodyBg = document.body.style.background;
    document.documentElement.style.background = "transparent";
    document.body.style.background = "transparent";
    return () => {
      document.documentElement.style.background = prevHtmlBg;
      document.body.style.background = prevBodyBg;
    };
  }, []);

  // Listen for Swift TTS lifecycle so we know when *our* "speaking"
  // is done. The Swift helper emits `voice:tts-ended` for both
  // didFinish AND didCancel, and the event is broadcast to every
  // window — so we gate on a small state machine that only
  // acknowledges the tts-ended that comes *after* our own tts-started.
  useEffect(() => {
    if (!isTauri()) return;
    let startUnsub: (() => void) | null = null;
    let endUnsub: (() => void) | null = null;
    (async () => {
      startUnsub = await tauriListen("voice:tts-started", () => {
        // Flip pending → playing on the next tts-started after our
        // voice_speak call. Anything that arrives while we're "none"
        // is somebody else's speech — ignore.
        if (speakPhaseRef.current === "pending") {
          speakPhaseRef.current = "playing";
        }
      });
      endUnsub = await tauriListen("voice:tts-ended", () => {
        // Only hide when this tts-ended matches our currently-playing
        // speech. tts-ended events that fire before our tts-started
        // (stale events, sibling-window TTS, etc.) are ignored.
        if (speakPhaseRef.current !== "playing") return;
        speakPhaseRef.current = "none";
        setStatus("idle");
        void hidePanel();
      });
    })();
    return () => {
      if (startUnsub) startUnsub();
      if (endUnsub) endUnsub();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Poll. Cookies-include authenticates via the session shared with
  // the main window — same trick as the voice widget.
  useEffect(() => {
    let cancelled = false;

    async function pollOnce() {
      if (busyRef.current) return;
      try {
        const res = await fetch("/api/v1/inbox?limit=20", {
          credentials: "include",
        });
        if (cancelled) return;
        if (!res.ok) {
          if (res.status === 401) {
            if (visibleRef.current) await hidePanel();
            visibleRef.current = false;
            setCount(0);
            return;
          }
          throw new Error(`inbox poll ${res.status}`);
        }
        const data = (await res.json()) as InboxResponse;
        if (cancelled) return;
        setCount(data.count);
        await syncPanelVisibility(data.count > 0);
      } catch (err) {
        if (cancelled) return;
        // eslint-disable-next-line no-console
        console.warn("[inbox-pill] poll failed", err);
      }
    }

    void pollOnce();
    const id = window.setInterval(pollOnce, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  async function syncPanelVisibility(shouldShow: boolean) {
    if (!isTauri()) return;
    if (shouldShow === visibleRef.current) return;
    visibleRef.current = shouldShow;
    try {
      if (shouldShow) {
        // Place the window at top-right of the currently active screen
        // BEFORE showing so the pill appears in the right spot without
        // a visible re-position flicker.
        await tauriInvoke("inbox_position_top_right");
        await tauriInvoke("inbox_show_panel");
      } else {
        await tauriInvoke("inbox_hide_panel");
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn("[inbox-pill] panel toggle failed", err);
    }
  }

  async function hidePanel() {
    visibleRef.current = false;
    if (!isTauri()) return;
    try {
      await tauriInvoke("inbox_hide_panel");
    } catch {
      // ignore
    }
  }

  async function handleClick() {
    if (status !== "idle") return;
    busyRef.current = true;
    setError(null);
    setStatus("summarising");

    if (isTauri()) {
      try {
        await tauriInvoke("inbox_make_panel_key");
      } catch {
        // ignore
      }
    }

    try {
      const res = await fetch("/api/v1/inbox/summarise", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "voice" }),
      });
      if (!res.ok) throw new Error(`summarise ${res.status}`);
      const data = (await res.json()) as SummariseResponse;
      const summary = data.summary?.trim();

      setCount(0);

      if (!summary) {
        setStatus("idle");
        void hidePanel();
        return;
      }

      setStatus("speaking");
      if (isTauri()) {
        try {
          // Mark our speak BEFORE invoking — that way if Swift's
          // tts-started arrives before the JS resolves, the listener
          // already sees "pending" and can flip to "playing".
          speakPhaseRef.current = "pending";
          await tauriInvoke("voice_speak", { text: summary });
        } catch (err) {
          // eslint-disable-next-line no-console
          console.warn("[inbox-pill] voice_speak failed", err);
          speakPhaseRef.current = "none";
          setStatus("idle");
          void hidePanel();
        }
      } else {
        setStatus("idle");
      }
    } catch (err) {
      setStatus("error");
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      busyRef.current = false;
    }
  }

  async function handleStop() {
    if (status !== "speaking") return;
    // Take ownership of the upcoming tts-ended event so the listener
    // doesn't double-hide after our manual cancel.
    speakPhaseRef.current = "none";
    if (isTauri()) {
      try {
        await tauriInvoke("voice_cancel_speech");
      } catch {
        // ignore — Swift may have already finished
      }
    }
    setStatus("idle");
    void hidePanel();
  }

  // Pill visuals — match voice-widget exactly.
  const isActive = status === "speaking" || status === "summarising";
  const gridColor = isActive
    ? "rgb(var(--primary))"
    : isDark
      ? "oklch(85.8% 0 0)"
      : "oklch(30.87% 0 0)";

  const stateLabel = (() => {
    if (status === "summarising") return "Summarising…";
    if (status === "speaking") return "Speaking…";
    if (status === "error") return "Retry";
    return count === 1 ? "1 message" : `${count} messages`;
  })();

  // While speaking, swap the pill for a stop control — same shape and
  // chrome, just a stop glyph instead of the flickering grid + count.
  if (status === "speaking") {
    return (
      <div className="flex h-screen w-screen flex-col items-end gap-1 p-2">
        <button
          type="button"
          onClick={handleStop}
          className="border-border bg-background-3 text-foreground hover:text-primary flex h-7 items-center gap-1.5 rounded-lg border px-2 text-xs font-medium shadow-md transition-colors"
          title="Stop"
          aria-label="Stop"
        >
          <span className="bg-primary text-primary-foreground grid h-4 w-4 place-items-center rounded">
            <Square size={9} className="fill-current" />
          </span>
          Stop
        </button>
      </div>
    );
  }

  return (
    <div className="flex h-screen w-screen flex-col items-end gap-1 p-2">
      <button
        type="button"
        onClick={handleClick}
        disabled={status === "summarising"}
        className={cn(
          "border-border bg-background-3 text-muted-foreground flex h-7 items-center gap-1.5 rounded-lg border px-2 text-xs font-medium shadow-md transition-colors",
          status === "error" && "border-destructive/40 text-destructive",
        )}
        title={
          status === "summarising"
            ? "Summarising your inbox…"
            : status === "error"
              ? (error ?? "Error — click to retry")
              : "Click to hear summary"
        }
      >
        <div className="relative h-3.5 w-5 overflow-hidden rounded-sm">
          <FlickeringGrid
            width={20}
            height={14}
            squareSize={2}
            gridGap={2}
            flickerChance={isActive ? 0.8 : 0.3}
            maxOpacity={isActive ? 0.9 : 0.25}
            color={gridColor}
          />
        </div>
        {stateLabel}
      </button>
    </div>
  );
}
