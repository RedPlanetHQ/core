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

// Liveness now flows from the foreground sidebar pill: it polls
// /api/v1/inbox every 20s with healthy timers and emits `inbox:kick`
// over Tauri events whenever the count changes. We listen for that
// and re-fetch. This interval is the cold fallback in case the main
// window isn't mounted; we keep it long so it doesn't race the kick.
const POLL_INTERVAL_MS = 60_000;

export default function InboxPill() {
  const [count, setCount] = useState(0);
  const [status, setStatus] = useState<PillStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  // Currently-spoken catchup text — rendered under the stop pill so
  // the user can read along while butler speaks (mirrors the partial
  // transcript card in the voice-widget).
  const [summary, setSummary] = useState<string>("");
  const [theme] = useTheme();
  const isDark = theme === Theme.DARK;

  const visibleRef = useRef(false);
  const busyRef = useRef(false);
  // Mirror of `status` so poll callbacks (closure-bound) can check the
  // latest value without restarting the polling effect.
  const statusRef = useRef<PillStatus>("idle");

  // Audio element for ElevenLabs playback. The voice_speak Swift path
  // is fire-and-forget; this handle lets the stop button pause cloud
  // playback and lets the "ended" event clean up state without
  // waiting on Swift's tts-ended bridge.
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioUrlRef = useRef<string | null>(null);
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
        setSummary("");
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
  // the main window — same trick as the voice widget. The real
  // liveness driver is the Rust poller (see inbox_poller.rs) which
  // emits `inbox:kick` whenever the count changes; we listen for
  // that below and trigger an immediate refresh.
  const pollOnceRef = useRef<() => Promise<void>>(async () => {});
  useEffect(() => {
    let cancelled = false;

    async function pollOnce() {
      if (busyRef.current) return;
      // Don't poll-and-reconcile while a catchup is mid-flight. The
      // server count is already 0 the instant /api/v1/inbox/summarise
      // stamps the rows checked, so any poll between then and
      // tts-ended would see 0 and (via syncPanelVisibility / 401
      // handling / 401 race) try to hide the panel while butler is
      // still speaking. syncPanelVisibility has its own status gate
      // as a backstop, but skipping the fetch altogether is cheaper
      // and removes the race surface entirely.
      const phase = statusRef.current;
      if (phase === "summarising" || phase === "speaking") return;
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
    pollOnceRef.current = pollOnce;

    void pollOnce();
    const id = window.setInterval(pollOnce, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  // Rust-driven liveness: every time the native poller sees the count
  // flip we get an `inbox:kick` event and re-fetch immediately. This
  // is what makes new inbox rows surface promptly even when the
  // window has been hidden long enough for the OS to throttle JS
  // timers in this WKWebView.
  useEffect(() => {
    if (!isTauri()) return;
    let unsub: (() => void) | null = null;
    (async () => {
      unsub = await tauriListen("inbox:kick", () => {
        void pollOnceRef.current();
      });
    })();
    return () => {
      if (unsub) unsub();
    };
  }, []);

  async function syncPanelVisibility(shouldShow: boolean) {
    if (!isTauri()) return;
    // Critical race guard: server count drops to zero the instant we
    // POST /api/v1/inbox/summarise. The sidebar pill notices that
    // change ~20s later and fires `inbox:kick`; the resulting re-poll
    // sees count=0 and (without this gate) would hide the panel
    // while butler is still reading the catchup out loud. So while
    // we're mid-catchup, we honor "show" but ignore "hide". The
    // tts-ended / audio.ended paths hide the panel explicitly when
    // playback actually finishes.
    if (!shouldShow) {
      const s = statusRef.current;
      if (s === "summarising" || s === "speaking") return;
    }
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

  // Mirror status into a ref every render so the poll closure can read
  // it without re-binding. Drives the catchup-active hide gate in
  // syncPanelVisibility.
  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  function clearAudio() {
    const a = audioRef.current;
    audioRef.current = null;
    if (a) {
      try {
        a.pause();
      } catch {
        // ignore
      }
    }
    if (audioUrlRef.current) {
      URL.revokeObjectURL(audioUrlRef.current);
      audioUrlRef.current = null;
    }
  }

  function finishSpeak() {
    speakPhaseRef.current = "none";
    clearAudio();
    setStatus("idle");
    setSummary("");
    void hidePanel();
  }

  /**
   * Speak the catchup. Tries the cloud TTS proxy first
   * (`/api/v1/voice/tts`) so ElevenLabs gets used when the user has
   * configured a key. Falls back to the local Swift voice
   * (`voice_speak`) if the route 204s (Apple-saved provider, no key,
   * etc.) or if anything in the cloud path fails.
   */
  async function speakSummary(text: string) {
    // Phase tracking — same gate as before for the Swift path. The
    // cloud path manages its own audio.ended handler so it doesn't
    // need the phase flip to fire "playing" via voice:tts-started.
    speakPhaseRef.current = "pending";

    try {
      const res = await fetch("/api/v1/voice/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ text }),
      });

      if (res.status === 204 || !res.ok) {
        // No cloud provider available (or it errored). Fall back to
        // the Swift voice.
        await speakViaSwift(text);
        return;
      }

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      audioUrlRef.current = url;
      const audio = new Audio(url);
      audioRef.current = audio;
      // The Swift bridge listens for voice:tts-started → playing →
      // tts-ended → hide. For the browser audio path, we skip that
      // dance and ride the <audio> element's own events.
      speakPhaseRef.current = "playing";

      audio.addEventListener("ended", () => {
        if (audioRef.current !== audio) return;
        finishSpeak();
      });
      audio.addEventListener("error", () => {
        if (audioRef.current !== audio) return;
        // Cloud playback failed mid-stream — try Swift as a salvage.
        clearAudio();
        void speakViaSwift(text).catch(() => finishSpeak());
      });

      await audio.play();
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn("[inbox-pill] cloud TTS failed, falling back to Swift", err);
      await speakViaSwift(text);
    }
  }

  async function speakViaSwift(text: string) {
    speakPhaseRef.current = "pending";
    if (!isTauri()) {
      // Browser dev preview — silent fallback.
      setStatus("idle");
      setSummary("");
      void hidePanel();
      return;
    }
    try {
      await tauriInvoke("voice_speak", { text });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn("[inbox-pill] voice_speak failed", err);
      finishSpeak();
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
      const summaryText = data.summary?.trim() ?? "";

      setCount(0);

      if (!summaryText) {
        setStatus("idle");
        void hidePanel();
        return;
      }

      setSummary(summaryText);
      setStatus("speaking");
      await speakSummary(summaryText);
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
    // Stop both possible playback paths. Audio first so we silence
    // the user immediately; Swift cancel is best-effort.
    clearAudio();
    if (isTauri()) {
      try {
        await tauriInvoke("voice_cancel_speech");
      } catch {
        // ignore — Swift may have already finished
      }
    }
    setStatus("idle");
    setSummary("");
    void hidePanel();
  }

  // Pill visuals — match voice-widget exactly. There's only ever one
  // pill: the label text and click handler flip based on status, but
  // the FlickeringGrid + chrome stay put. While speaking, clicking
  // the same pill stops the speech.
  const isActive = status === "speaking" || status === "summarising";
  const gridColor = isActive
    ? "rgb(var(--primary))"
    : isDark
      ? "oklch(85.8% 0 0)"
      : "oklch(30.87% 0 0)";

  const stateLabel = (() => {
    if (status === "summarising") return "Summarising…";
    if (status === "speaking") return "Stop";
    if (status === "error") return "Retry";
    return count === 1 ? "1 message" : `${count} messages`;
  })();

  const onPillClick = status === "speaking" ? handleStop : handleClick;
  const pillTitle = (() => {
    if (status === "summarising") return "Summarising your inbox…";
    if (status === "speaking") return "Click to stop";
    if (status === "error") return error ?? "Error — click to retry";
    return "Click to hear summary";
  })();

  return (
    <div className="flex h-screen w-screen flex-col items-end gap-1 p-2">
      <button
        type="button"
        onClick={onPillClick}
        disabled={status === "summarising"}
        className={cn(
          "border-border bg-background-3 text-muted-foreground flex h-7 items-center gap-1.5 rounded-lg border px-2 text-xs font-medium shadow-md transition-colors",
          status === "speaking" && "text-foreground hover:text-primary",
          status === "error" && "border-destructive/40 text-destructive",
        )}
        title={pillTitle}
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

      {status === "speaking" && summary && (
        <div
          className="border-border bg-background-3 text-foreground max-h-[100px] max-w-[320px] overflow-y-auto rounded-lg border px-2.5 py-1.5 leading-snug shadow-md"
          aria-live="polite"
        >
          {summary}
        </div>
      )}
    </div>
  );
}
