/**
 * Voice widget — continuous-conversation pill for the Tauri "voice"
 * window.
 *
 * Default state: a small pill (FlickeringGrid + label) at the top-right
 * of the floating voice window.
 *
 * Lifecycle (driven by Rust hotkey events):
 *   voice:invoke-payload         → user held Ctrl+Option for 2 s →
 *                                  enter active mode + start listening
 *   voice:partial                → audio detected; pill flips to
 *                                  "Listening…"
 *   voice:silence-timeout        → ~500 ms of silence after speech →
 *                                  auto-commit the turn (→ "Thinking…")
 *   voice:ctrl-tap-payload       → single Ctrl tap: commit the current
 *                                  turn while listening; barge in
 *                                  while the assistant is speaking
 *   stream complete + TTS        → "Speaking…" then mic auto-reopens
 *                                  for the next turn (active mode)
 *   voice:invoke-expand-payload  → double-tap Ctrl: exits active mode
 *                                  if a session is running (no-op
 *                                  otherwise — the old "open chat box"
 *                                  behavior was removed)
 *
 * Click the pill → panel expands to show the full conversation. Esc on
 * the expanded panel collapses back to the pill.
 */

import { useEffect, useRef, useState } from "react";
import {
  json,
  type LoaderFunctionArgs,
  type MetaFunction,
} from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { Theme, useTheme } from "remix-themes";

import { isTauri, tauriInvoke, tauriListen } from "~/lib/tauri.client";
import { FlickeringGrid } from "~/components/ui/flickering-grid";
import { Button, Input } from "~/components/ui";
import { cn } from "~/lib/utils";
import { ArrowRight, X } from "lucide-react";
import { requireWorkpace } from "~/services/session.server";

export const meta: MetaFunction = () => [{ title: "Butler" }];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  // The pill's idle label shows the workspace name as a quick "this is
  // your butler" identifier. Falls back to "Butler" if no workspace
  // (shouldn't happen in practice for an authed widget mount).
  try {
    const workspace = await requireWorkpace(request);
    return json({ workspaceName: workspace?.name ?? "Butler" });
  } catch {
    return json({ workspaceName: "Butler" });
  }
};

type Status =
  | "idle"
  | "armed"
  | "listening"
  | "thinking"
  | "speaking"
  | "error";

interface ScreenContext {
  app: string;
  title?: string | null;
  text?: string | null;
}

interface Turn {
  role: "user" | "assistant" | "progress";
  text: string;
}

const SENTENCE_BOUNDARY = /([.!?])\s/;
const AUTO_HIDE_DELAY_MS = 1200;
/**
 * Active-mode auto-exit: if the mic is open and we don't hear the user
 * say anything for this long, drop active mode rather than sitting hot
 * forever. Reset whenever speech is detected (so it only counts
 * end-of-conversation idleness, not normal pauses).
 */
const ACTIVE_IDLE_TIMEOUT_MS = 30_000;

export default function VoiceWidget() {
  const [status, setStatus] = useState<Status>("idle");
  const [expanded, setExpanded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [textDraft, setTextDraft] = useState("");
  // Live partial transcript shown under the pill while the user is
  // speaking. Cleared at start of each hold and once the turn is sent.
  const [partialText, setPartialText] = useState("");
  const [theme] = useTheme();
  const isDark = theme === Theme.DARK;
  const { workspaceName } = useLoaderData<typeof loader>();

  const conversationIdRef = useRef<string | null>(null);
  const screenContextRef = useRef<ScreenContext | null>(null);
  const ttsBufferRef = useRef<string>("");
  const ttsConsumedRef = useRef<number>(0);
  const ttsActiveRef = useRef<boolean>(false);
  const inFlightRef = useRef<AbortController | null>(null);
  /** Mode of the in-flight turn — drives whether the streamed reply is spoken. */
  const currentTurnModeRef = useRef<"voice" | "text">("voice");
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** ElevenLabs audio queue — sentences play sequentially via <audio>. */
  const elQueueRef = useRef<HTMLAudioElement[]>([]);
  const elActiveRef = useRef<HTMLAudioElement | null>(null);
  /**
   * Outstanding Swift utterances the frontend has queued via `voice_speak`
   * but hasn't seen a matching `voice:tts-ended` for. AVSpeechSynthesizer
   * emits `tts-ended` per utterance, so it goes to zero briefly between
   * sentences even though more are queued in Swift. Without this counter,
   * `finishAssistantTurn` would reopen the mic in that gap and the
   * recognizer would pick up the assistant's next sentence.
   */
  const pendingSwiftTtsRef = useRef<number>(0);
  /** toolCallIds of progress_update events already spoken — dedupe across retries. */
  const spokenProgressRef = useRef<Set<string>>(new Set());
  /** True while butler is in an active continuous-conversation session. */
  const activeModeRef = useRef<boolean>(false);
  /** Did we receive any partial transcript during the current turn? */
  const heardSpeechRef = useRef<boolean>(false);
  const expandedRef = useRef<boolean>(false);
  /** Mirror of `status` for use inside Tauri event callbacks (which
   * capture state at first render). */
  const statusRef = useRef<Status>("idle");
  /** Auto-exit timer for active mode — armed when the mic opens
   * without speech, cleared on first speech. */
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    expandedRef.current = expanded;
  }, [expanded]);

  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  // ── Make the host html/body transparent so the pill / rounded panel
  //    has no surrounding solid frame. Scoped to this route via cleanup.
  useEffect(() => {
    if (typeof document === "undefined") return;
    const previousHtmlBg = document.documentElement.style.background;
    const previousBodyBg = document.body.style.background;
    document.documentElement.style.background = "transparent";
    document.body.style.background = "transparent";
    document.body.classList.add("voice-widget-host");
    return () => {
      document.documentElement.style.background = previousHtmlBg;
      document.body.style.background = previousBodyBg;
      document.body.classList.remove("voice-widget-host");
    };
  }, []);

  // ── Tauri event subscriptions ────────────────────────────────────────────
  useEffect(() => {
    if (!isTauri()) return;

    const unsubs: Array<Promise<() => void>> = [];

    // Held Ctrl+Option for 2 s → enter active conversation mode.
    unsubs.push(
      tauriListen<{ screenContext: ScreenContext | null }>(
        "voice:invoke-payload",
        (event) => {
          screenContextRef.current = event.payload?.screenContext ?? null;
          enterActiveMode();
        },
      ),
    );

    // Double-tap Ctrl: only used to exit an in-flight active session.
    // The previous "open the expanded text chat box" branch was removed
    // — double-tapping with no session does nothing now.
    unsubs.push(
      tauriListen<{ screenContext: ScreenContext | null }>(
        "voice:invoke-expand-payload",
        (event) => {
          screenContextRef.current = event.payload?.screenContext ?? null;
          if (activeModeRef.current) {
            console.log("[voice-widget] double-ctrl → exit active mode");
            exitActiveMode();
          }
        },
      ),
    );

    // Single Ctrl tap during an active session: commit the current
    // turn while listening, or barge in if butler is speaking.
    unsubs.push(
      tauriListen("voice:ctrl-tap-payload", () => {
        if (!activeModeRef.current) return;
        const s = statusRef.current;
        if (s === "listening" || (s === "armed" && heardSpeechRef.current)) {
          commitTurn();
        } else if (s === "speaking" || ttsActiveRef.current) {
          bargeIn();
        }
        // armed-without-speech and thinking are intentional no-ops:
        // there's nothing yet to commit, and we don't want to abort a
        // turn that's already in flight.
      }),
    );

    // VAD fired: ~500 ms of silence after the user finished speaking.
    // Treated as an implicit "I'm done with this turn" in active mode.
    unsubs.push(
      tauriListen("voice:silence-timeout", () => {
        if (!activeModeRef.current) return;
        const s = statusRef.current;
        if (s === "listening" || (s === "armed" && heardSpeechRef.current)) {
          console.log("[voice-widget] silence-timeout → commit");
          commitTurn();
        }
      }),
    );

    unsubs.push(
      tauriListen<{ text: string; isFinal: boolean | null }>(
        "voice:partial",
        (event) => {
          const text = event.payload?.text ?? "";
          if (text.trim().length > 0) {
            if (!heardSpeechRef.current) {
              // First speech this turn — user is engaged, cancel the
              // active-mode idle timer.
              clearIdleTimer();
            }
            heardSpeechRef.current = true;
            // First partial transitions "armed" → "listening".
            setStatus((s) => (s === "armed" ? "listening" : s));
          }
          setPartialText(text);
          // Barge-in during TTS: any meaningful partial cancels speech.
          if (ttsActiveRef.current && text.split(/\s+/).length > 3) {
            cancelAllTTS();
          }
        },
      ),
    );

    unsubs.push(
      tauriListen<{ text: string }>("voice:final", (event) => {
        const text = (event.payload?.text ?? "").trim();
        if (!text) return;
        sendTurn(text);
      }),
    );

    unsubs.push(
      tauriListen("voice:tts-started", () => {
        ttsActiveRef.current = true;
        clearHideTimer();
        setStatus("speaking");
      }),
    );

    unsubs.push(
      tauriListen("voice:tts-ended", () => {
        // Swift emits tts-ended per AVSpeechUtterance. Between utterances
        // the counter drops to zero briefly even though we've queued more
        // — only treat "TTS totally done" when the counter for utterances
        // WE dispatched hits zero. Otherwise the reopen-mic path below
        // would fire in that gap and the recognizer would pick up the
        // next sentence.
        if (pendingSwiftTtsRef.current > 0) {
          pendingSwiftTtsRef.current -= 1;
        }
        if (pendingSwiftTtsRef.current > 0) {
          console.log(
            `[voice-widget] tts-ended (${pendingSwiftTtsRef.current} utterance(s) still queued) → keep mic closed`,
          );
          return;
        }
        ttsActiveRef.current = false;
        // Stream still flowing (subagent mid-work between progress
        // beats, or main reply not yet complete). Stay in "thinking"
        // and do NOT arm the hide timer — the end-of-stream path
        // takes the next step once sendTurn drops inFlightRef.
        if (inFlightRef.current) {
          console.log("[voice-widget] tts-ended (stream in flight) → stay thinking");
          setStatus("thinking");
          clearHideTimer();
          return;
        }
        finishAssistantTurn("tts-ended");
      }),
    );

    unsubs.push(
      tauriListen<{ message: string }>("voice:error", (event) => {
        setError(event.payload?.message ?? "voice error");
        setStatus("error");
      }),
    );

    return () => {
      unsubs.forEach((p) => p.then((fn) => fn()).catch(() => {}));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Permissions on mount ─────────────────────────────────────────────────
  useEffect(() => {
    if (!isTauri()) return;
    void tauriInvoke("voice_request_permissions");
    return () => {
      activeModeRef.current = false;
      inFlightRef.current?.abort();
      cancelAllTTS();
      void tauriInvoke("voice_cancel_listening");
      clearHideTimer();
      clearIdleTimer();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Esc closes the panel entirely (when expanded). The pill alone has
  //    no Esc binding — it auto-hides via the lifecycle.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && expandedRef.current) {
        e.preventDefault();
        e.stopPropagation();
        closeWidget();
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // When the widget expands, promote the NSPanel to key so clicks on
  // buttons (like the X) register on the first try. Without this, a
  // non-activating panel eats the first mouse click just to become
  // key, and the user has to click twice on the close button.
  useEffect(() => {
    if (!expanded || !isTauri()) return;
    void tauriInvoke("voice_make_panel_key");
  }, [expanded]);

  function closeWidget() {
    // Esc / X / explicit dismiss always ends a running active session
    // so the mic isn't left hot after the panel goes away.
    if (activeModeRef.current) {
      exitActiveMode();
      return;
    }
    setExpanded(false);
    void hideWindow();
  }

  // ── Active-mode lifecycle ────────────────────────────────────────────────
  function enterActiveMode() {
    activeModeRef.current = true;
    heardSpeechRef.current = false;
    clearHideTimer();
    setError(null);
    setPartialText("");
    // Each fresh active session starts in pill (collapsed) mode.
    setExpanded(false);
    // If butler was mid-sentence from a prior conversation, drop it —
    // the user just opened a new session.
    if (ttsActiveRef.current) cancelAllTTS();
    inFlightRef.current?.abort();
    inFlightRef.current = null;
    setStatus("armed");
    void tauriInvoke("voice_start_listening");
    armIdleTimer();
  }

  function exitActiveMode() {
    activeModeRef.current = false;
    clearIdleTimer();
    clearHideTimer();
    inFlightRef.current?.abort();
    inFlightRef.current = null;
    cancelAllTTS();
    void tauriInvoke("voice_cancel_listening");
    heardSpeechRef.current = false;
    setStatus("idle");
    setPartialText("");
    if (!expandedRef.current) void hideWindow();
  }

  /** Commit the current turn: stop the recognizer, which will emit
   * one last `voice:final` → `sendTurn` → assistant reply. */
  function commitTurn() {
    clearIdleTimer();
    setStatus("thinking");
    void tauriInvoke("voice_stop_listening");
  }

  /** Cut the assistant off mid-speech and open the mic for the user's
   * next turn. */
  function bargeIn() {
    cancelAllTTS();
    inFlightRef.current?.abort();
    inFlightRef.current = null;
    heardSpeechRef.current = false;
    setPartialText("");
    setStatus("armed");
    void tauriInvoke("voice_start_listening");
    armIdleTimer();
  }

  /** After the assistant finishes speaking, hand the floor back to the
   * user — opens the mic and arms the idle timer. */
  function reopenMicForNextTurn() {
    heardSpeechRef.current = false;
    setPartialText("");
    setError(null);
    setStatus("armed");
    void tauriInvoke("voice_start_listening");
    armIdleTimer();
  }

  /** Decide what happens once an assistant turn (stream + TTS) is
   * fully drained: active mode reopens the mic, idle mode schedules
   * the auto-hide. Shared by all three drain code paths. */
  function finishAssistantTurn(source: string) {
    if (activeModeRef.current) {
      console.log(`[voice-widget] ${source} → reopen mic (active)`);
      reopenMicForNextTurn();
    } else {
      console.log(`[voice-widget] ${source} → scheduling auto-hide`);
      setStatus("idle");
      scheduleAutoHide();
    }
  }

  function armIdleTimer() {
    clearIdleTimer();
    idleTimerRef.current = setTimeout(() => {
      if (!activeModeRef.current) return;
      // Only fire when we genuinely never heard speech this turn. If
      // the user already started talking, the partial handler cleared
      // this timer; if they finished, the commit path did.
      if (heardSpeechRef.current) return;
      console.log("[voice-widget] active-mode idle timeout — exiting");
      exitActiveMode();
    }, ACTIVE_IDLE_TIMEOUT_MS);
  }

  function clearIdleTimer() {
    if (idleTimerRef.current) {
      clearTimeout(idleTimerRef.current);
      idleTimerRef.current = null;
    }
  }

  async function hideWindow() {
    if (!isTauri()) return;
    // Route through the Rust-side NSPanel hide — Tauri's JS hide() does
    // not always trigger the swizzled NSPanel hide path on macOS.
    await tauriInvoke("voice_hide_panel");
  }

  function scheduleAutoHide() {
    clearHideTimer();
    hideTimerRef.current = setTimeout(() => {
      // Don't auto-hide if the user has expanded the panel — they're
      // actively reading the conversation.
      if (expandedRef.current) {
        console.log("[voice-widget] auto-hide skipped (expanded)");
        return;
      }
      // Any sign of pending work (open SSE stream, queued/active TTS)
      // means the pill should stay visible as "thinking" / "speaking".
      // The end-of-stream / end-of-TTS paths re-arm this timer once the
      // refs clear.
      if (inFlightRef.current || ttsActiveRef.current) {
        console.log(
          "[voice-widget] auto-hide skipped (inFlight=" +
            (inFlightRef.current ? "1" : "0") +
            " ttsActive=" +
            (ttsActiveRef.current ? "1" : "0") +
            ")",
        );
        return;
      }
      console.log("[voice-widget] auto-hide firing → voice_hide_panel");
      void hideWindow();
    }, AUTO_HIDE_DELAY_MS);
  }

  function clearHideTimer() {
    if (hideTimerRef.current) {
      clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
  }

  async function sendTurn(
    transcript: string,
    turnMode: "voice" | "text" = "voice",
  ) {
    inFlightRef.current?.abort();
    const controller = new AbortController();
    inFlightRef.current = controller;
    currentTurnModeRef.current = turnMode;

    // For text-mode turns, the user might have typed in the panel
    // after switching apps — get a fresh AX snapshot of whatever's
    // frontmost right now, not whatever was captured at panel open.
    if (turnMode === "text" && isTauri()) {
      try {
        const fresh = await tauriInvoke<ScreenContext | null>(
          "get_current_screen_text",
        );
        if (fresh) screenContextRef.current = fresh;
      } catch (err) {
        console.warn("[voice-widget] get_current_screen_text failed", err);
      }
    }

    const ctx = screenContextRef.current;
    console.log("[voice-widget] sending turn", {
      mode: turnMode,
      transcript_len: transcript.length,
      transcript_preview: transcript.slice(0, 80),
      screen_context: ctx
        ? {
            app: ctx.app,
            title: ctx.title,
            text_len: ctx.text?.length ?? 0,
            text_preview: ctx.text?.slice(0, 200) ?? null,
          }
        : null,
    });

    setTurns((prev) => [...prev, { role: "user", text: transcript }]);
    setPartialText("");
    setStatus("thinking");
    ttsBufferRef.current = "";
    ttsConsumedRef.current = 0;
    spokenProgressRef.current.clear();

    try {
      const response = await fetch("/api/v1/voice/turn", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        signal: controller.signal,
        body: JSON.stringify({
          conversationId: conversationIdRef.current,
          transcript,
          screenContext: screenContextRef.current,
          mode: turnMode,
        }),
      });

      if (!response.ok || !response.body) {
        throw new Error(`voice-turn: ${response.status}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let nl: number;
        while ((nl = buffer.indexOf("\n")) !== -1) {
          const line = buffer.slice(0, nl).trim();
          buffer = buffer.slice(nl + 1);
          if (!line.startsWith("data:")) continue;
          const data = line.slice(5).trim();
          if (!data || data === "[DONE]") continue;
          try {
            const event = JSON.parse(data);
            handleStreamEvent(event);
          } catch {
            /* ignore malformed line */
          }
        }
      }
    } catch (err) {
      if ((err as Error).name === "AbortError") return;
      setError(err instanceof Error ? err.message : String(err));
      setStatus("error");
      scheduleAutoHide();
      return;
    }

    // Flush any tail TTS that didn't cross a sentence boundary —
    // voice-mode turns only. Text-mode turns are silent.
    if (currentTurnModeRef.current === "voice") {
      const tail = ttsBufferRef.current.slice(ttsConsumedRef.current).trim();
      if (tail) {
        await speakSentence(tail);
      } else if (!ttsActiveRef.current) {
        setStatus("idle");
      }
    } else {
      // Text-mode reply rendered to screen; no TTS, no auto-hide
      // (user is reading the expanded panel).
      setStatus("idle");
    }

    inFlightRef.current = null;
    // Stream is done and no TTS chunks are still in flight: time to
    // either hand the floor back (active mode) or schedule the
    // auto-hide. The TTS-end paths short-circuit on inFlight!=null
    // while we were streaming, so this is the catch-up for them.
    if (currentTurnModeRef.current === "voice" && !ttsActiveRef.current) {
      finishAssistantTurn("sendTurn-end");
    }
  }

  function handleStreamEvent(event: any) {
    console.log(event);
    if (event.type === "text-delta" && typeof event.delta === "string") {
      appendAssistantText(event.delta);
    } else if (event.type === "text" && typeof event.text === "string") {
      appendAssistantText(event.text);
    } else if (
      event.type === "data-text-delta" &&
      typeof event.data === "string"
    ) {
      appendAssistantText(event.data);
    } else if (
      (event.type === "tool-input-available" || event.type === "tool-call") &&
      event.toolName === "progress_update"
    ) {
      // Agent narrates long work via progress_update — surface those
      // beats in the voice widget too. Speak them through the same
      // sentence queue as the main reply (so they interleave in order
      // and barge-in cancels them along with everything else).
      const id = typeof event.toolCallId === "string" ? event.toolCallId : null;
      if (id && spokenProgressRef.current.has(id)) return;
      if (id) spokenProgressRef.current.add(id);
      const payload = (event.input ?? event.args) as
        | { message?: unknown }
        | undefined;
      const message =
        typeof payload?.message === "string" ? payload.message.trim() : "";
      if (!message) return;
      setTurns((prev) => [...prev, { role: "progress", text: message }]);
      if (currentTurnModeRef.current === "voice") {
        void speakSentence(message);
      }
    }
  }

  function appendAssistantText(delta: string) {
    setTurns((prev) => {
      const last = prev[prev.length - 1];
      if (last?.role === "assistant") {
        const next = [...prev];
        next[next.length - 1] = { ...last, text: last.text + delta };
        return next;
      }
      // Lazy assistant turn — created on first delta so any progress
      // updates that fire before the reply starts render above it.
      return [...prev, { role: "assistant", text: delta }];
    });

    // Text-mode turns are read silently — skip TTS.
    if (currentTurnModeRef.current !== "voice") return;

    ttsBufferRef.current += delta;
    while (true) {
      const remaining = ttsBufferRef.current.slice(ttsConsumedRef.current);
      const match = remaining.match(SENTENCE_BOUNDARY);
      if (!match || match.index === undefined) break;
      const cut = match.index + match[0].length;
      const sentence = remaining.slice(0, cut).trim();
      ttsConsumedRef.current += cut;
      if (sentence) {
        void speakSentence(sentence);
      }
    }
  }

  // ── Sentence-level TTS dispatch ──────────────────────────────────────────
  // Try ElevenLabs (server proxy) first. If the server returns 204
  // (user opted into Apple, or no API key), fall back to the local
  // Swift helper. Either path emits voice:tts-started / voice:tts-ended
  // so the UI state machine works the same.
  async function speakSentence(text: string) {
    if (!isTauri()) return;
    try {
      const res = await fetch("/api/v1/voice/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ text }),
      });

      if (res.status === 204 || !res.ok) {
        void tauriInvoke("voice_log_tts_backend", {
          backend: "apple-swift",
          chars: text.length,
        });
        // Flip TTS-active synchronously so the sendTurn-end check
        // doesn't reopen the mic before Swift has even started
        // playback (it dispatches `voice:tts-started` asynchronously,
        // and in the gap the recognizer would happily transcribe the
        // assistant's own voice through the mic). The `voice:tts-ended`
        // handler is what reopens the floor once playback finishes.
        //
        // Track outstanding utterances so tts-ended between sentences
        // doesn't prematurely reopen the mic — Swift emits one per
        // utterance, and we need the WHOLE queue drained.
        pendingSwiftTtsRef.current += 1;
        ttsActiveRef.current = true;
        clearHideTimer();
        setStatus("speaking");
        await tauriInvoke("voice_speak", { text });
        return;
      }

      void tauriInvoke("voice_log_tts_backend", {
        backend: "elevenlabs",
        chars: text.length,
      });
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);

      audio.addEventListener("ended", () => {
        URL.revokeObjectURL(url);
        elActiveRef.current = null;
        const next = elQueueRef.current.shift();
        if (next) {
          elActiveRef.current = next;
          void next.play();
        } else {
          // Queue drained — surface the same end-of-speech transition the
          // Swift helper emits, so the active-mode reopen / idle auto-hide
          // path runs.
          ttsActiveRef.current = false;
          // Mirror the tts-ended gate: stream still flowing → stay
          // visible as "thinking" and don't arm the hide timer.
          if (inFlightRef.current) {
            setStatus("thinking");
            clearHideTimer();
          } else {
            finishAssistantTurn("11labs-queue-drained");
          }
        }
      });
      audio.addEventListener("error", () => {
        URL.revokeObjectURL(url);
        elActiveRef.current = null;
      });

      if (elActiveRef.current) {
        elQueueRef.current.push(audio);
      } else {
        elActiveRef.current = audio;
        ttsActiveRef.current = true;
        clearHideTimer();
        setStatus("speaking");
        await audio.play();
      }
    } catch (err) {
      console.warn("[voice-widget] elevenlabs speak failed, falling back", err);
      void tauriInvoke("voice_log_tts_backend", {
        backend: "apple-swift",
        chars: text.length,
      });
      // Same synchronous flip as the 204 branch — keep the mic shut
      // until Swift's tts-ended event arrives.
      pendingSwiftTtsRef.current += 1;
      ttsActiveRef.current = true;
      clearHideTimer();
      setStatus("speaking");
      void tauriInvoke("voice_speak", { text });
    }
  }

  /** Cancel both ElevenLabs queued audio AND any in-flight Apple speech. */
  function cancelAllTTS() {
    void tauriInvoke("voice_cancel_speech");
    for (const a of elQueueRef.current) {
      try {
        a.pause();
      } catch {
        // ignore
      }
    }
    elQueueRef.current = [];
    if (elActiveRef.current) {
      try {
        elActiveRef.current.pause();
      } catch {
        // ignore
      }
      elActiveRef.current = null;
    }
    // Zero the Swift utterance counter: `voice_cancel_speech` in the
    // Swift helper calls `stopSpeaking(at: .immediate)`, which fires
    // `didCancel` (→ `tts-ended`) for the CURRENTLY-playing utterance
    // only. Any queued but unstarted utterances are silently discarded
    // with no tts-ended, so a residual positive count here would leave
    // the mic pinned closed forever on the next turn.
    pendingSwiftTtsRef.current = 0;
    ttsActiveRef.current = false;
  }

  // ── Render ───────────────────────────────────────────────────────────────
  // Primary tint only when mic is actively picking up the user (listening)
  // or butler is talking back (speaking). "Armed" and "Thinking" stay muted
  // — there's no audio flowing in either direction.
  const isActive = status === "listening" || status === "speaking";

  const stateLabel = (() => {
    if (status === "armed") return "Ready";
    if (status === "listening") return "Listening…";
    if (status === "thinking") return "Thinking…";
    if (status === "speaking") return "Speaking…";
    if (status === "error") return "Error";
    return workspaceName;
  })();

  const gridColor = isActive
    ? "rgb(var(--primary))"
    : isDark
      ? "oklch(85.8% 0 0)"
      : "oklch(30.87% 0 0)";

  if (!expanded) {
    // Show the live partial transcript under the pill while listening
    // (and briefly while thinking, so the user sees what was captured
    // until the assistant bubble appears in the expanded view).
    const showTranscript =
      (status === "listening" || status === "thinking") &&
      partialText.trim().length > 0;

    return (
      <div className="flex h-screen w-screen flex-col items-start justify-end gap-1 p-2">
        {showTranscript && (
          <div
            className="border-border bg-background-3 text-foreground max-w-[320px] rounded-lg border px-2.5 py-1.5 text-xs leading-snug shadow-md"
            aria-live="polite"
          >
            {partialText}
          </div>
        )}
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="border-border bg-background-3 text-muted-foreground flex h-7 items-center gap-1.5 rounded-lg border px-2 text-xs font-medium shadow-md transition-colors"
          title="Click to expand"
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

  return (
    <div className="bg-background-3 text-foreground border-border relative flex h-screen flex-col gap-2 overflow-hidden rounded-lg border p-3 text-sm shadow-2xl">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
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
          <div className="text-muted-foreground text-xs">{stateLabel}</div>
        </div>
        <button
          type="button"
          onClick={closeWidget}
          className="text-muted-foreground hover:text-foreground hover:bg-accent grid h-6 w-6 place-items-center rounded text-xs"
          aria-label="Close"
          title="Esc to close"
        >
          <X size={16} />
        </button>
      </div>

      {error && (
        <div className="bg-destructive/15 text-destructive rounded-md px-3 py-1.5 text-xs">
          ⚠ {error}
        </div>
      )}

      <div className="flex flex-1 flex-col gap-1.5 overflow-y-auto pr-1">
        {turns.length === 0 && !error && (
          <div className="text-muted-foreground my-auto text-center text-xs">
            Type below, or hold <kbd>Ctrl</kbd>+<kbd>Option</kbd> for 2 s to
            start a voice conversation. Tap <kbd>Ctrl</kbd> to commit or
            barge in; double-tap to exit.
          </div>
        )}
        {turns.map((t, i) => {
          if (t.role === "progress") {
            return (
              <div
                key={i}
                className="text-muted-foreground self-center px-2 py-0.5 text-[11px] italic leading-snug"
              >
                {t.text}
              </div>
            );
          }
          return (
            <div
              key={i}
              className={cn(
                "max-w-[85%] rounded-md px-3 py-1.5 text-[13px] leading-snug",
                t.role === "user"
                  ? "bg-primary/15 text-foreground self-end"
                  : "bg-accent text-foreground self-start",
              )}
            >
              {t.text || (t.role === "assistant" ? "…" : "")}
            </div>
          );
        })}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          const text = textDraft.trim();
          if (!text) return;
          setTextDraft("");
          sendTurn(text, "text");
        }}
        className="flex items-center gap-2"
      >
        <Input
          autoFocus
          value={textDraft}
          onChange={(e) => setTextDraft(e.target.value)}
          placeholder="message butler…"
          disabled={status === "thinking"}
          className="!h-9 !min-h-9 flex-1"
        />
        <Button
          type="submit"
          variant="secondary"
          className="h-9 shrink-0"
          disabled={!textDraft.trim() || status === "thinking"}
          aria-label="Send"
        >
          <ArrowRight className="h-4 w-4" />
        </Button>
      </form>

      <div className="text-muted-foreground mt-1 text-center font-mono text-[10px]">
        Esc to close
      </div>
    </div>
  );
}
