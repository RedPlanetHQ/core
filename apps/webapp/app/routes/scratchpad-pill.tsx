/**
 * Bottom-left corner launcher + ambient glow — Tauri-only.
 *
 * Three rendered states (driven by a single derived `mode`):
 *
 *   - "hidden"   — nothing to surface and cursor isn't in the corner.
 *                  The NSPanel is OS-hidden so the bottom-left of the
 *                  user's screen is fully untouched.
 *   - "glow"     — there are unread messages but the cursor isn't yet
 *                  in the corner. A soft Siri-style multi-blob glow
 *                  pulses out from the bottom-left to pull the user's
 *                  eye / cursor toward it. Panel is shown but mouse
 *                  events pass through to the underlying app.
 *   - "launcher" — cursor reached the hot corner (or a catchup is in
 *                  flight). The glow fades and the launcher card
 *                  fades in. Panel is shown and clickable.
 *
 * Cookie session is shared with the main window so we don't need a PAT.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import {
  json,
  type LoaderFunctionArgs,
  type MetaFunction,
} from "@remix-run/node";
import { Check, Inbox, Square, StickyNote, X } from "lucide-react";

import { Button } from "~/components/ui";
import { SamAvatar } from "~/components/ui/sam-avatar";
import { isTauri, tauriInvoke, tauriListen } from "~/lib/tauri.client";
import { cn } from "~/lib/utils";

export const meta: MetaFunction = () => [{ title: "Scratchpad" }];

export const loader = (_args: LoaderFunctionArgs) => json({});

type InboxStatus = "idle" | "summarising" | "speaking" | "error";
type Mode = "hidden" | "glow" | "launcher";

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

// Cold fallback inbox poll — `inbox:kick` from the main window drives
// most refreshes; this is the timer that keeps us honest if the kick
// channel ever goes quiet.
const POLL_INTERVAL_MS = 60_000;

// CSS keyframes for the Siri-style ambient glow. Injected once at
// module scope so the rules don't get re-created on every mount.
const GLOW_KEYFRAMES = `
@keyframes core-glow-blob-a {
  0%, 100% { transform: translate(0, 0) scale(1); opacity: 0.75; }
  50%      { transform: translate(28px, -18px) scale(1.18); opacity: 1; }
}
@keyframes core-glow-blob-b {
  0%, 100% { transform: translate(0, 0) scale(0.9); opacity: 0.55; }
  50%      { transform: translate(-18px, -28px) scale(1.08); opacity: 0.85; }
}
@keyframes core-glow-blob-c {
  0%, 100% { transform: translate(0, 0) scale(1.05); opacity: 0.45; }
  50%      { transform: translate(16px, 16px) scale(0.86); opacity: 0.7; }
}
`;

export default function ScratchpadLauncher() {
  // ── Inputs ─────────────────────────────────────────────────────────
  const [count, setCount] = useState(0);
  const [status, setStatus] = useState<InboxStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState("");
  const [inCorner, setInCorner] = useState(false);
  const [hudOpen, setHudOpen] = useState(false);
  // User explicitly dismissed the launcher card (X button or opened
  // Today). Suppresses launcher mode without killing the ambient
  // glow — the corner still nudges if new messages arrive. Re-armed
  // when the cursor leaves the corner or a new message comes in.
  const [dismissed, setDismissed] = useState(false);

  // ── Derived mode ───────────────────────────────────────────────────
  const mode: Mode = useMemo(() => {
    // During a catchup the launcher card MUST stay clickable and
    // visible regardless of cursor position — the user is reading
    // along with the spoken summary.
    if (
      status === "summarising" ||
      status === "speaking" ||
      status === "error"
    ) {
      return "launcher";
    }
    // HUD is up — the corner is occupied by something the user is
    // already engaging with. Don't hint toward it.
    if (hudOpen) return "hidden";
    if (dismissed) return count > 0 ? "glow" : "hidden";
    if (inCorner) return "launcher";
    if (count > 0) return "glow";
    return "hidden";
  }, [count, status, inCorner, hudOpen, dismissed]);

  // Re-arm dismissal when the cursor leaves the corner so re-entering
  // surfaces the launcher again.
  useEffect(() => {
    if (!inCorner) setDismissed(false);
  }, [inCorner]);

  // Re-arm dismissal when a new message arrives — it's a fresh signal
  // worth re-surfacing.
  const prevCountRef = useRef(count);
  useEffect(() => {
    if (count > prevCountRef.current) setDismissed(false);
    prevCountRef.current = count;
  }, [count]);

  // Stable refs for poll closures.
  const statusRef = useRef<InboxStatus>("idle");
  const busyRef = useRef(false);
  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  // ── Sync OS panel state to derived mode ────────────────────────────
  useEffect(() => {
    if (!isTauri()) return;
    void (async () => {
      try {
        if (mode === "hidden") {
          await tauriInvoke("scratchpad_pill_hide");
          return;
        }
        // Glow is decorative — make the panel click-through so the
        // user can interact with whatever's underneath. Launcher mode
        // takes clicks back.
        await tauriInvoke("scratchpad_pill_set_clickthrough", {
          ignore: mode === "glow",
        });
        await tauriInvoke("scratchpad_pill_show");
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn("[launcher] panel sync failed", err);
      }
    })();
  }, [mode]);

  // ── Background strip so the rounded panel has no frame ─────────────
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

  // ── Corner-enter / corner-leave from the Rust cursor poll ──────────
  useEffect(() => {
    if (!isTauri()) return;
    let enterUnsub: (() => void) | null = null;
    let leaveUnsub: (() => void) | null = null;
    (async () => {
      enterUnsub = await tauriListen("scratchpad:corner-enter", () =>
        setInCorner(true),
      );
      leaveUnsub = await tauriListen("scratchpad:corner-leave", () =>
        setInCorner(false),
      );
    })();
    return () => {
      if (enterUnsub) enterUnsub();
      if (leaveUnsub) leaveUnsub();
    };
  }, []);

  // ── HUD visibility from scratchpad_panel.rs ────────────────────────
  useEffect(() => {
    if (!isTauri()) return;
    let shownUnsub: (() => void) | null = null;
    let hiddenUnsub: (() => void) | null = null;
    (async () => {
      shownUnsub = await tauriListen("scratchpad-hud:shown", () =>
        setHudOpen(true),
      );
      hiddenUnsub = await tauriListen("scratchpad-hud:hidden", () =>
        setHudOpen(false),
      );
    })();
    return () => {
      if (shownUnsub) shownUnsub();
      if (hiddenUnsub) hiddenUnsub();
    };
  }, []);

  // ── Inbox poll ─────────────────────────────────────────────────────
  const pollOnceRef = useRef<() => Promise<void>>(async () => {});
  useEffect(() => {
    let cancelled = false;
    async function pollOnce() {
      if (busyRef.current) return;
      const phase = statusRef.current;
      if (phase === "summarising" || phase === "speaking") return;
      try {
        const res = await fetch("/api/v1/inbox?limit=20", {
          credentials: "include",
        });
        if (cancelled) return;
        if (!res.ok) {
          if (res.status === 401) {
            setCount(0);
            return;
          }
          throw new Error(`inbox poll ${res.status}`);
        }
        const data = (await res.json()) as InboxResponse;
        if (cancelled) return;
        setCount(data.count);
      } catch (err) {
        if (cancelled) return;
        // eslint-disable-next-line no-console
        console.warn("[launcher] poll failed", err);
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

  // ── TTS lifecycle ──────────────────────────────────────────────────
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioUrlRef = useRef<string | null>(null);
  const speakPhaseRef = useRef<"none" | "pending" | "playing">("none");

  useEffect(() => {
    if (!isTauri()) return;
    let startUnsub: (() => void) | null = null;
    let endUnsub: (() => void) | null = null;
    (async () => {
      startUnsub = await tauriListen("voice:tts-started", () => {
        if (speakPhaseRef.current === "pending") {
          speakPhaseRef.current = "playing";
        }
      });
      endUnsub = await tauriListen("voice:tts-ended", () => {
        if (speakPhaseRef.current !== "playing") return;
        finishSpeak();
      });
    })();
    return () => {
      if (startUnsub) startUnsub();
      if (endUnsub) endUnsub();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
    busyRef.current = false;
    setStatus("idle");
    setSummary("");
    // The server has already zeroed the inbox count; the mode
    // re-evaluation drives the visible state from here (hidden if
    // nothing else is pending, glow if new messages arrived during
    // playback).
  }

  async function speakSummary(text: string) {
    speakPhaseRef.current = "pending";
    try {
      const res = await fetch("/api/v1/voice/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ text }),
      });

      if (res.status === 204 || !res.ok) {
        await speakViaSwift(text);
        return;
      }

      void tauriInvoke("voice_log_tts_backend", {
        backend: "elevenlabs",
        chars: text.length,
      });
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      audioUrlRef.current = url;
      const audio = new Audio(url);
      audioRef.current = audio;
      speakPhaseRef.current = "playing";

      audio.addEventListener("ended", () => {
        if (audioRef.current !== audio) return;
        finishSpeak();
      });
      audio.addEventListener("error", () => {
        if (audioRef.current !== audio) return;
        clearAudio();
        void speakViaSwift(text).catch(() => finishSpeak());
      });

      await audio.play();
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn("[launcher] cloud TTS failed, falling back to Swift", err);
      await speakViaSwift(text);
    }
  }

  async function speakViaSwift(text: string) {
    speakPhaseRef.current = "pending";
    if (!isTauri()) {
      finishSpeak();
      return;
    }
    try {
      void tauriInvoke("voice_log_tts_backend", {
        backend: "apple-swift",
        chars: text.length,
      });
      await tauriInvoke("voice_speak", { text });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn("[launcher] voice_speak failed", err);
      finishSpeak();
    }
  }

  // ── Click handlers ─────────────────────────────────────────────────
  async function openToday() {
    // Dismiss preemptively so closing the HUD doesn't pop the
    // launcher back open if the cursor is still in the corner.
    setDismissed(true);
    if (!isTauri()) return;
    try {
      await tauriInvoke("scratchpad_hud_make_panel_key");
      await tauriInvoke("scratchpad_hud_show");
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn("[launcher] open hud failed", err);
    }
  }

  async function startCatchup() {
    if (status !== "idle" || count === 0) return;
    busyRef.current = true;
    setError(null);
    setStatus("summarising");

    if (isTauri()) {
      try {
        await tauriInvoke("scratchpad_pill_make_panel_key");
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
        busyRef.current = false;
        setStatus("idle");
        return;
      }

      setSummary(summaryText);
      setStatus("speaking");
      await speakSummary(summaryText);
    } catch (err) {
      busyRef.current = false;
      setStatus("error");
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function stopCatchup() {
    if (status !== "speaking") return;
    speakPhaseRef.current = "none";
    clearAudio();
    if (isTauri()) {
      try {
        await tauriInvoke("voice_cancel_speech");
      } catch {
        // ignore
      }
    }
    busyRef.current = false;
    setStatus("idle");
    setSummary("");
  }

  // ── Render ─────────────────────────────────────────────────────────
  const inCatchup =
    status === "summarising" || status === "speaking" || status === "error";

  const inboxLabel = (() => {
    if (status === "summarising") return "Summarising…";
    if (status === "speaking") return "Stop";
    if (status === "error") return "Retry";
    if (count === 0) return "Nothing to catch up";
    return count === 1 ? "1 message" : `${count} messages`;
  })();

  const inboxRowClickable = (() => {
    if (status === "summarising") return false;
    if (status === "speaking") return true;
    if (status === "error") return true;
    return count > 0;
  })();

  const onInboxRowClick = () => {
    if (status === "speaking") return void stopCatchup();
    return void startCatchup();
  };

  const showCard = mode === "launcher";
  const showGlow = mode === "glow";

  return (
    <div className="relative h-screen w-screen overflow-hidden">
      <style dangerouslySetInnerHTML={{ __html: GLOW_KEYFRAMES }} />

      {/* Ambient Siri-style corner glow — three primary-colored blobs
          drifting under a heavy blur. Pure CSS, no JS animation loop. */}
      <div
        aria-hidden
        className={cn(
          "pointer-events-none absolute bottom-0 left-0 h-[260px] w-[260px] transition-opacity duration-500 ease-out",
          showGlow ? "opacity-100" : "opacity-0",
        )}
        style={{ filter: "blur(22px)" }}
      >
        <div
          className="bg-primary absolute -bottom-12 -left-12 h-[180px] w-[180px] rounded-full"
          style={{
            animation: "core-glow-blob-a 4s ease-in-out infinite",
            willChange: "transform, opacity",
          }}
        />
        <div
          className="bg-primary/70 absolute bottom-4 left-16 h-[150px] w-[150px] rounded-full"
          style={{
            animation: "core-glow-blob-b 5.2s ease-in-out infinite",
            willChange: "transform, opacity",
          }}
        />
        <div
          className="bg-primary/45 absolute -left-4 bottom-24 h-[130px] w-[130px] rounded-full"
          style={{
            animation: "core-glow-blob-c 6.4s ease-in-out infinite",
            willChange: "transform, opacity",
          }}
        />
      </div>

      {/* Launcher card */}
      <div
        className={cn(
          "absolute bottom-0 left-0 transition-all duration-200 ease-out",
          showCard
            ? "translate-y-0 opacity-100"
            : "pointer-events-none translate-y-2 opacity-0",
        )}
      >
        <div className="border-border bg-background-3 relative flex w-[224px] flex-col gap-1 rounded-xl border p-1.5 shadow-xl">
          {!inCatchup && (
            <Button
              variant="ghost"
              size="xs"
              onClick={() => setDismissed(true)}
              className="text-muted-foreground hover:text-foreground absolute right-1 top-1 z-10 h-5 w-5"
              title="Dismiss"
              aria-label="Dismiss launcher"
            >
              <X size={12} />
            </Button>
          )}

          {!inCatchup && (
            <Button
              variant="ghost"
              full
              onClick={openToday}
              className="text-foreground h-9 justify-start gap-2 px-2 text-sm font-medium"
              title="Open today's scratchpad"
            >
              <StickyNote size={16} className="text-muted-foreground" />
              Today
            </Button>
          )}

          {inboxRowClickable ? (
            <Button
              variant="ghost"
              full
              onClick={onInboxRowClick}
              isLoading={status === "summarising"}
              disabled={status === "summarising"}
              className={cn(
                "h-9 justify-start gap-2 px-2 text-sm font-medium",
                status === "error" && "text-destructive",
              )}
              title={
                status === "error"
                  ? (error ?? "Error — click to retry")
                  : status === "speaking"
                    ? "Click to stop"
                    : "Click to hear summary"
              }
            >
              {status === "speaking" ? (
                <Square size={14} className="fill-current" />
              ) : (
                <SamAvatar size={20} />
              )}
              {inboxLabel}
            </Button>
          ) : (
            <div
              className="text-muted-foreground flex h-[24px] cursor-default items-center gap-2 rounded px-2 text-sm"
              title="All clear"
            >
              {count === 0 && status === "idle" ? (
                <Check size={16} className="text-muted-foreground" />
              ) : (
                <Inbox size={16} className="text-muted-foreground" />
              )}
              {inboxLabel}
            </div>
          )}

          {status === "speaking" && summary && (
            <div
              className="text-foreground mt-1 max-h-[140px] overflow-y-auto px-2.5 py-1.5 text-xs leading-snug"
              aria-live="polite"
            >
              {summary}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
