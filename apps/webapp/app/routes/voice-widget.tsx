/**
 * Voice widget — call-card UI for the Tauri "voice" window.
 *
 * Subscribes to Rust-side events:
 *   - voice:invoke-payload → { pageContext }
 *   - voice:partial         → { text, isFinal }
 *   - voice:final           → { text }
 *   - voice:tts-started / :tts-ended
 *   - voice:permissions
 *   - voice:error
 *
 * Calls Tauri commands:
 *   voice_start_listening / voice_stop_listening / voice_speak / voice_cancel_speech
 *
 * Posts each user turn to /api/v1/voice-turn (SSE), accumulates the
 * reply, and feeds each completed sentence into voice_speak so TTS
 * starts before the full reply has streamed.
 */

import { useEffect, useRef, useState } from "react";
import type { MetaFunction } from "@remix-run/node";

import { isTauri, tauriInvoke, tauriListen } from "~/lib/tauri.client";

export const meta: MetaFunction = () => [{ title: "Butler" }];

type Status = "idle" | "listening" | "thinking" | "speaking" | "error";
type Mode = "voice" | "text";

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

export default function VoiceWidget() {
  const [status, setStatus] = useState<Status>("listening");
  const [mode, setMode] = useState<Mode>("voice");
  const [error, setError] = useState<string | null>(null);
  const [partial, setPartial] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [textDraft, setTextDraft] = useState("");

  const conversationIdRef = useRef<string | null>(null);
  const pageContextRef = useRef<PageContext | null>(null);
  const ttsBufferRef = useRef<string>("");
  const ttsConsumedRef = useRef<number>(0);
  const ttsActiveRef = useRef<boolean>(false);
  const inFlightRef = useRef<AbortController | null>(null);

  // ── Tauri event subscriptions ────────────────────────────────────────────
  useEffect(() => {
    if (!isTauri()) return;

    const unsubs: Array<Promise<() => void>> = [];

    unsubs.push(
      tauriListen<{ pageContext: PageContext | null }>(
        "voice:invoke-payload",
        (event) => {
          pageContextRef.current = event.payload?.pageContext ?? null;
          // Cancel any in-flight TTS / request and start a fresh turn.
          startListeningSession();
        },
      ),
    );

    unsubs.push(
      tauriListen<{ text: string; isFinal: boolean | null }>(
        "voice:partial",
        (event) => {
          const text = event.payload?.text ?? "";
          setPartial(text);

          // Barge-in: while butler is speaking, a partial >3 words means
          // the user has actually started talking (and not just an echo
          // blip). Cancel TTS and treat this as the next user turn.
          if (ttsActiveRef.current && text.split(/\s+/).length > 3) {
            void tauriInvoke("voice_cancel_speech");
            ttsActiveRef.current = false;
          }
        },
      ),
    );

    unsubs.push(
      tauriListen<{ text: string }>("voice:final", (event) => {
        const text = (event.payload?.text ?? "").trim();
        if (!text) return;
        setPartial("");
        sendTurn(text, "voice");
      }),
    );

    unsubs.push(
      tauriListen("voice:tts-started", () => {
        ttsActiveRef.current = true;
        setStatus("speaking");
      }),
    );

    unsubs.push(
      tauriListen("voice:tts-ended", () => {
        ttsActiveRef.current = false;
        // After TTS, drop back to listening for the next turn.
        setStatus("listening");
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

  // ── Lifecycle: start listening on mount, cleanup on unmount ──────────────
  useEffect(() => {
    if (!isTauri()) return;
    void tauriInvoke("voice_request_permissions");
    startListeningSession();
    return () => {
      inFlightRef.current?.abort();
      void tauriInvoke("voice_cancel_speech");
      void tauriInvoke("voice_stop_listening");
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Esc + click-outside dismissal ────────────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") void closeWindow();
      if (e.key === "Tab") {
        e.preventDefault();
        toggleMode();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  function startListeningSession() {
    if (mode !== "voice") return;
    setStatus("listening");
    setPartial("");
    void tauriInvoke("voice_start_listening");
  }

  function toggleMode() {
    setMode((prev) => {
      const next = prev === "voice" ? "text" : "voice";
      if (next === "text") {
        void tauriInvoke("voice_stop_listening");
        setStatus("idle");
      } else {
        startListeningSession();
      }
      return next;
    });
  }

  async function closeWindow() {
    inFlightRef.current?.abort();
    await tauriInvoke("voice_cancel_speech");
    await tauriInvoke("voice_stop_listening");
    if (isTauri()) {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      await getCurrentWindow().hide();
    }
  }

  function sendTextDraft(e: React.FormEvent) {
    e.preventDefault();
    const text = textDraft.trim();
    if (!text) return;
    setTextDraft("");
    sendTurn(text, "text");
  }

  async function sendTurn(transcript: string, turnMode: Mode) {
    inFlightRef.current?.abort();
    const controller = new AbortController();
    inFlightRef.current = controller;

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

      // Optimistically append an empty assistant turn — fill it as we stream.
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
            handleStreamEvent(event, turnMode);
          } catch {
            // ignore malformed line
          }
        }
      }
    } catch (err) {
      if ((err as Error).name === "AbortError") return;
      setError(err instanceof Error ? err.message : String(err));
      setStatus("error");
      return;
    }

    // Flush any tail TTS that hasn't crossed a sentence boundary.
    if (turnMode === "voice") {
      const tail = ttsBufferRef.current.slice(ttsConsumedRef.current).trim();
      if (tail) {
        await tauriInvoke("voice_speak", { text: tail });
      } else if (!ttsActiveRef.current) {
        setStatus("listening");
      }
    } else {
      setStatus("idle");
    }

    inFlightRef.current = null;
    if (turnMode === "voice") {
      // Reopen mic for the next turn.
      void tauriInvoke("voice_start_listening");
    }
  }

  function handleStreamEvent(event: any, turnMode: Mode) {
    // AI SDK v6 UIMessage stream emits a variety of event types. We only
    // care about text-delta-style chunks here.
    if (event.type === "text-delta" && typeof event.delta === "string") {
      appendAssistantText(event.delta, turnMode);
    } else if (event.type === "text" && typeof event.text === "string") {
      appendAssistantText(event.text, turnMode);
    } else if (
      event.type === "data-text-delta" &&
      typeof event.data === "string"
    ) {
      appendAssistantText(event.data, turnMode);
    }
  }

  function appendAssistantText(delta: string, turnMode: Mode) {
    setTurns((prev) => {
      if (prev.length === 0) return prev;
      const next = [...prev];
      const last = next[next.length - 1];
      if (last.role !== "assistant") return prev;
      next[next.length - 1] = { ...last, text: last.text + delta };
      return next;
    });

    if (turnMode !== "voice") return;
    ttsBufferRef.current += delta;

    // Speak each completed sentence as soon as it lands.
    while (true) {
      const remaining = ttsBufferRef.current.slice(ttsConsumedRef.current);
      const match = remaining.match(SENTENCE_BOUNDARY);
      if (!match || match.index === undefined) break;
      const cut = match.index + match[0].length;
      const sentence = remaining.slice(0, cut).trim();
      ttsConsumedRef.current += cut;
      if (sentence) {
        void tauriInvoke("voice_speak", { text: sentence });
      }
    }
  }

  // ── Render ───────────────────────────────────────────────────────────────
  const lastTurn = turns.length ? turns[turns.length - 1] : null;
  const showingPartial = mode === "voice" && partial.length > 0 && status === "listening";

  return (
    <div
      className="flex h-screen flex-col gap-2 rounded-3xl border border-white/10 bg-zinc-900/85 p-4 text-sm text-zinc-100 shadow-2xl backdrop-blur-xl"
      style={{ borderRadius: 24 }}
      onMouseDown={(e) => {
        // Click-outside dismissal: the window itself is just the panel,
        // so background click-through isn't possible without a separate
        // overlay. Instead, we rely on Esc + the window losing focus.
        e.stopPropagation();
      }}
    >
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="grid h-8 w-8 place-items-center rounded-full bg-emerald-500/20 text-emerald-300">
            B
          </div>
          <div className="font-medium">Butler</div>
        </div>
        <button
          type="button"
          onClick={toggleMode}
          className="rounded-full bg-white/5 px-3 py-1 text-xs text-zinc-300 hover:bg-white/10"
          title="Tab to toggle"
        >
          {mode === "voice" ? "🎤 voice" : "ABC text"}
        </button>
      </header>

      <StatusRow status={status} error={error} />

      <div className="flex flex-1 flex-col gap-2 overflow-y-auto pr-1">
        {turns.map((t, i) => (
          <div
            key={i}
            className={`max-w-[85%] rounded-2xl px-3 py-2 ${
              t.role === "user"
                ? "self-end bg-emerald-600/30 text-emerald-50"
                : "self-start bg-white/5 text-zinc-100"
            }`}
          >
            {t.text || (t.role === "assistant" ? "…" : "")}
          </div>
        ))}
        {showingPartial && (
          <div className="max-w-[85%] self-end rounded-2xl bg-emerald-600/15 px-3 py-2 text-emerald-100/80 italic">
            {partial}
          </div>
        )}
      </div>

      {mode === "text" && (
        <form onSubmit={sendTextDraft} className="flex gap-2">
          <input
            autoFocus
            value={textDraft}
            onChange={(e) => setTextDraft(e.target.value)}
            placeholder="type a message…"
            className="flex-1 rounded-full bg-white/5 px-3 py-2 outline-none placeholder:text-zinc-500 focus:bg-white/10"
          />
          <button
            type="submit"
            disabled={!textDraft.trim() || status === "thinking"}
            className="rounded-full bg-emerald-500/80 px-3 py-2 text-zinc-950 hover:bg-emerald-500 disabled:opacity-40"
          >
            ↵
          </button>
        </form>
      )}

      <footer className="text-center text-[10px] text-zinc-500">
        Esc to close · Tab to switch mode
      </footer>
    </div>
  );
}

function StatusRow({
  status,
  error,
}: {
  status: Status;
  error: string | null;
}) {
  if (status === "error") {
    return (
      <div className="rounded-xl bg-red-500/15 px-3 py-2 text-xs text-red-200">
        ⚠ {error ?? "Something went wrong."}
      </div>
    );
  }

  const dot = {
    listening: "bg-emerald-400 animate-pulse",
    thinking: "bg-amber-400 animate-pulse",
    speaking: "bg-sky-400 animate-pulse",
    idle: "bg-zinc-500",
    error: "bg-red-400",
  }[status];
  const label = {
    listening: "Listening…",
    thinking: "Thinking…",
    speaking: "Speaking…",
    idle: "Ready",
    error: "Error",
  }[status];

  return (
    <div className="flex items-center gap-2 text-xs text-zinc-400">
      <span className={`h-2 w-2 rounded-full ${dot}`} />
      {label}
    </div>
  );
}
