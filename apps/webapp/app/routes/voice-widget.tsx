/**
 * Voice widget — push-to-talk pill for the Tauri "voice" window.
 *
 * Default state: a small pill (FlickeringGrid + label) at the top-right
 * of the floating voice window.
 *
 * Lifecycle (driven by Rust hotkey events):
 *   voice:invoke           → user pressed Ctrl+Option → start listening
 *   voice:partial          → audio detected; pill flips to "Listening…"
 *   voice:hold-end-payload → user released the chord → finalize the
 *                            recognition; pill enters "Thinking…" once
 *                            we've sent the turn
 *   stream complete + TTS  → pill shows "Speaking…" then auto-hides
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

interface PageContext {
  app: string;
  title?: string | null;
  text?: string | null;
}

interface Turn {
  role: "user" | "assistant";
  text: string;
}

const SENTENCE_BOUNDARY = /([.!?])\s/;
const AUTO_HIDE_DELAY_MS = 1200;

export default function VoiceWidget() {
  const [status, setStatus] = useState<Status>("idle");
  const [expanded, setExpanded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [textDraft, setTextDraft] = useState("");
  const [theme] = useTheme();
  const isDark = theme === Theme.DARK;
  const { workspaceName } = useLoaderData<typeof loader>();

  const conversationIdRef = useRef<string | null>(null);
  const pageContextRef = useRef<PageContext | null>(null);
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
  /** True while the user has the chord held — controls "armed" vs "listening" transition */
  const chordHeldRef = useRef<boolean>(false);
  /** Did we receive any partial transcript during this hold? Drives finalization. */
  const heardSpeechRef = useRef<boolean>(false);
  const expandedRef = useRef<boolean>(false);

  useEffect(() => {
    expandedRef.current = expanded;
  }, [expanded]);

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

    unsubs.push(
      tauriListen<{ pageContext: PageContext | null }>(
        "voice:invoke-payload",
        (event) => {
          pageContextRef.current = event.payload?.pageContext ?? null;
          startHoldSession();
        },
      ),
    );

    // Double-tap Ctrl: open in expanded mode without starting to listen.
    // Stays open until Esc.
    unsubs.push(
      tauriListen<{ pageContext: PageContext | null }>(
        "voice:invoke-expand-payload",
        (event) => {
          pageContextRef.current = event.payload?.pageContext ?? null;
          clearHideTimer();
          setError(null);
          setExpanded(true);
        },
      ),
    );

    unsubs.push(
      tauriListen("voice:hold-end-payload", () => {
        endHoldSession();
      }),
    );

    unsubs.push(
      tauriListen<{ text: string; isFinal: boolean | null }>(
        "voice:partial",
        (event) => {
          const text = event.payload?.text ?? "";
          if (text.trim().length > 0) {
            heardSpeechRef.current = true;
            // First partial transitions "armed" → "listening".
            setStatus((s) => (s === "armed" ? "listening" : s));
          }
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
        console.log("[voice-widget] tts-ended → scheduling auto-hide");
        ttsActiveRef.current = false;
        setStatus("idle");
        scheduleAutoHide();
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
      inFlightRef.current?.abort();
      cancelAllTTS();
      void tauriInvoke("voice_cancel_listening");
      clearHideTimer();
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
    setExpanded(false);
    void hideWindow();
  }

  // ── Lifecycle helpers ────────────────────────────────────────────────────
  function startHoldSession() {
    chordHeldRef.current = true;
    heardSpeechRef.current = false;
    clearHideTimer();
    setError(null);
    // Each new push-to-talk session starts in pill (collapsed) mode —
    // any leftover expanded state from a previous conversation is reset.
    setExpanded(false);
    // Cancel any in-flight TTS — barge-in into a fresh turn.
    if (ttsActiveRef.current) {
      cancelAllTTS();
    }
    setStatus("armed");
    void tauriInvoke("voice_start_listening");
  }

  function endHoldSession() {
    chordHeldRef.current = false;
    if (heardSpeechRef.current) {
      // Heard speech — finalize. Recognizer will emit one last `final`
      // and we'll process it through to TTS. Pill stays visible
      // through the thinking → speaking cycle, then auto-hides.
      setStatus("thinking");
      void tauriInvoke("voice_stop_listening");
    } else {
      // Silent release — hide immediately unless the user has
      // expanded the panel (they're actively reading history).
      void tauriInvoke("voice_cancel_listening");
      setStatus("idle");
      if (!expandedRef.current) {
        void hideWindow();
      }
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
        const fresh = await tauriInvoke<PageContext | null>(
          "get_current_screen_text",
        );
        if (fresh) pageContextRef.current = fresh;
      } catch (err) {
        console.warn("[voice-widget] get_current_screen_text failed", err);
      }
    }

    const ctx = pageContextRef.current;
    console.log("[voice-widget] sending turn", {
      mode: turnMode,
      transcript_len: transcript.length,
      transcript_preview: transcript.slice(0, 80),
      page_context: ctx
        ? {
            app: ctx.app,
            title: ctx.title,
            text_len: ctx.text?.length ?? 0,
            text_preview: ctx.text?.slice(0, 200) ?? null,
          }
        : null,
    });

    setTurns((prev) => [...prev, { role: "user", text: transcript }]);
    setStatus("thinking");
    ttsBufferRef.current = "";
    ttsConsumedRef.current = 0;

    try {
      const response = await fetch("/api/v1/voice-turn", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        signal: controller.signal,
        body: JSON.stringify({
          conversationId: conversationIdRef.current,
          transcript,
          pageContext: pageContextRef.current,
          mode: turnMode,
        }),
      });

      if (!response.ok || !response.body) {
        throw new Error(`voice-turn: ${response.status}`);
      }

      setTurns((prev) => [...prev, { role: "assistant", text: "" }]);

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
        scheduleAutoHide();
      }
    } else {
      // Text-mode reply rendered to screen; no TTS, no auto-hide
      // (user is reading the expanded panel).
      setStatus("idle");
    }

    inFlightRef.current = null;
  }

  function handleStreamEvent(event: any) {
    if (event.type === "text-delta" && typeof event.delta === "string") {
      appendAssistantText(event.delta);
    } else if (event.type === "text" && typeof event.text === "string") {
      appendAssistantText(event.text);
    } else if (
      event.type === "data-text-delta" &&
      typeof event.data === "string"
    ) {
      appendAssistantText(event.data);
    }
  }

  function appendAssistantText(delta: string) {
    setTurns((prev) => {
      if (prev.length === 0) return prev;
      const next = [...prev];
      const last = next[next.length - 1];
      if (last.role !== "assistant") return prev;
      next[next.length - 1] = { ...last, text: last.text + delta };
      return next;
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
      const res = await fetch("/api/v1/voice-tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ text }),
      });

      if (res.status === 204 || !res.ok) {
        await tauriInvoke("voice_speak", { text });
        return;
      }

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
          // Swift helper emits, so scheduleAutoHide / status updates run.
          ttsActiveRef.current = false;
          setStatus("idle");
          scheduleAutoHide();
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
    return (
      <div className="flex h-screen w-screen items-start justify-end p-2">
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
            Type below, or hold <kbd>Ctrl</kbd>+<kbd>Option</kbd> and speak.
          </div>
        )}
        {turns.map((t, i) => (
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
        ))}
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
