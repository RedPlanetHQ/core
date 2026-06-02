/**
 * Streaming TTS playback for an accumulating assistant message.
 *
 * Consumers pass the latest accumulated assistant text on every render.
 * The hook keeps an internal cursor, slices off any newly completed
 * sentences, POSTs them to `/api/v1/voice/tts`, and plays the returned
 * audio sequentially through a single `<audio>` queue.
 *
 * When `enabled` flips to false (user toggled voice mode off, or the
 * conversation ended) we drop the queue and stop whatever is playing
 * — so a half-finished sentence isn't left talking after the user
 * has visibly moved on.
 *
 * The conversation only really has one "live" assistant message at a
 * time, so the hook resets its cursor whenever the input text shrinks
 * (a new assistant message replaces the previous one).
 */

import { useEffect, useRef } from "react";

import { isTauri, tauriInvoke } from "~/lib/tauri.client";

const SENTENCE_BOUNDARY = /([.!?])\s/;

export interface UseStreamingTTSOptions {
  enabled: boolean;
  /** Latest accumulating assistant text — pass on every render. */
  text: string;
  /**
   * True while the assistant is still streaming. When this flips to
   * false we flush whatever tail hasn't crossed a sentence boundary
   * yet so the user hears the full reply.
   */
  isStreaming: boolean;
}

export function useStreamingTTS({
  enabled,
  text,
  isStreaming,
}: UseStreamingTTSOptions): void {
  const consumedRef = useRef(0);
  // The actual text we've seen so far. Lets us detect a "new message
  // started" condition (text got shorter) and reset.
  const seenRef = useRef("");
  const queueRef = useRef<HTMLAudioElement[]>([]);
  const activeRef = useRef<HTMLAudioElement | null>(null);
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;
  // Tracks the previous value of `enabled` across renders so we can
  // detect the off→on transition. Without this, flipping voice mode
  // on inside a conversation that already has assistant text would
  // make us iterate from the start of that text and speak every old
  // sentence aloud.
  const prevEnabledRef = useRef(enabled);

  // Drop all audio and reset cursors. Called on disable + new-message.
  const flush = () => {
    for (const a of queueRef.current) {
      try {
        a.pause();
      } catch {
        // ignore
      }
    }
    queueRef.current = [];
    if (activeRef.current) {
      try {
        activeRef.current.pause();
      } catch {
        // ignore
      }
      activeRef.current = null;
    }
  };

  const enqueueSentence = async (sentence: string) => {
    if (!enabledRef.current) return;
    const runningInTauri = safeIsTauri();
    try {
      // Tauri path: don't pin the runtime to cloud — let the server
      // honor the user's saved provider (which is "apple" by default).
      // Browser path: tell the server "I have no local synth" so it
      // picks the first available cloud provider for us.
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (!runningInTauri) headers["X-Voice-Context"] = "browser";

      const res = await fetch("/api/v1/voice/tts", {
        method: "POST",
        headers,
        credentials: "include",
        body: JSON.stringify({ text: sentence }),
      });
      if (!enabledRef.current) return;

      // 204 = local provider chosen server-side. In Tauri we route to
      // the Swift helper so the user still hears the reply; in the
      // browser there's no local synth, so the text on screen is the
      // only signal.
      if (res.status === 204) {
        if (runningInTauri) {
          try {
            await tauriInvoke("voice_speak", { text: sentence });
          } catch {
            // best-effort
          }
        }
        return;
      }
      if (!res.ok) return;
      const blob = await res.blob();
      if (!enabledRef.current) return;
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audio.addEventListener("ended", () => {
        URL.revokeObjectURL(url);
        if (activeRef.current === audio) {
          activeRef.current = null;
          const next = queueRef.current.shift();
          if (next) {
            activeRef.current = next;
            void next.play();
          }
        }
      });
      audio.addEventListener("error", () => {
        URL.revokeObjectURL(url);
        if (activeRef.current === audio) activeRef.current = null;
      });

      if (activeRef.current) {
        queueRef.current.push(audio);
      } else {
        activeRef.current = audio;
        await audio.play();
      }
    } catch {
      // best-effort
    }
  };

  // Tauri cancel: when voice mode flips off, also stop any in-flight
  // Swift speech triggered by the 204 fallback above.
  const cancelLocalSpeech = () => {
    if (!safeIsTauri()) return;
    void tauriInvoke("voice_cancel_speech").catch(() => {});
  };

  // Tear down on unmount.
  useEffect(
    () => () => {
      flush();
      cancelLocalSpeech();
    },
    [],
  );

  // Combined: handle enable/disable transitions and segment sentences
  // on every text update. The off→on transition adopts whatever is
  // already on screen as fully consumed so we don't replay history.
  useEffect(() => {
    const wasEnabled = prevEnabledRef.current;
    prevEnabledRef.current = enabled;

    if (!enabled) {
      // Disable → drop everything in flight.
      if (wasEnabled) {
        flush();
        cancelLocalSpeech();
        consumedRef.current = 0;
        seenRef.current = "";
      }
      return;
    }

    // Just turned on — anything already in the buffer was generated
    // before voice mode came up. Treat it as already heard.
    if (!wasEnabled) {
      consumedRef.current = text.length;
      seenRef.current = text;
      return;
    }

    // New assistant message replaced the previous one — text shrank.
    if (text.length < seenRef.current.length) {
      flush();
      cancelLocalSpeech();
      consumedRef.current = 0;
    }
    seenRef.current = text;

    let cursor = consumedRef.current;
    while (true) {
      const remaining = text.slice(cursor);
      const match = remaining.match(SENTENCE_BOUNDARY);
      if (!match || match.index === undefined) break;
      const cut = match.index + match[0].length;
      const sentence = remaining.slice(0, cut).trim();
      cursor += cut;
      if (sentence) void enqueueSentence(sentence);
    }
    consumedRef.current = cursor;

    // Stream finished — flush any tail that never hit a boundary.
    if (!isStreaming) {
      const tail = text.slice(consumedRef.current).trim();
      if (tail) {
        consumedRef.current = text.length;
        void enqueueSentence(tail);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, isStreaming, enabled]);
}

function safeIsTauri(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return isTauri();
  } catch {
    return false;
  }
}
