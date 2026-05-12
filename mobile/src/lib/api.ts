import EventSource from "react-native-sse";

import { CORE_API_URL } from "./config";

export type VoiceTurnRequest = {
  transcript: string;
  conversationId?: string | null;
  mode?: "voice" | "text";
};

type StreamEvent =
  | { type: "text-delta"; delta: string }
  | { type: "text"; text: string }
  | { type: "data-text-delta"; data: string }
  | { type: string; [key: string]: unknown };

export type VoiceTurnHandlers = {
  onDelta: (delta: string) => void;
  onError: (err: Error) => void;
  onDone: () => void;
};

/**
 * Streams the agent reply for a voice turn.
 *
 * Mirrors the SSE consumer in apps/webapp/app/routes/voice-widget.tsx —
 * data lines carry AI SDK v6 events, we accumulate `delta` strings from
 * `text-delta` / `text` / `data-text-delta` and ignore the rest.
 *
 * Returns a function to abort the in-flight stream.
 */
export function streamVoiceTurn(
  token: string,
  body: VoiceTurnRequest,
  handlers: VoiceTurnHandlers,
): () => void {
  const url = `${CORE_API_URL}/api/v1/voice-turn`;

  const es = new EventSource(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      Accept: "text/event-stream",
    },
    body: JSON.stringify({
      transcript: body.transcript,
      conversationId: body.conversationId ?? undefined,
      mode: body.mode ?? "voice",
    }),
    pollingInterval: 0,
  });

  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    es.removeAllEventListeners();
    es.close();
  };

  es.addEventListener("message", (event) => {
    const data = event.data;
    if (!data || data === "[DONE]") {
      if (data === "[DONE]") {
        handlers.onDone();
        finish();
      }
      return;
    }

    let parsed: StreamEvent;
    try {
      parsed = JSON.parse(data);
    } catch {
      return;
    }

    if (parsed.type === "text-delta" && typeof parsed.delta === "string") {
      handlers.onDelta(parsed.delta);
    } else if (parsed.type === "text" && typeof parsed.text === "string") {
      handlers.onDelta(parsed.text);
    } else if (
      parsed.type === "data-text-delta" &&
      typeof parsed.data === "string"
    ) {
      handlers.onDelta(parsed.data);
    }
  });

  es.addEventListener("error", (event) => {
    const message =
      "message" in event && typeof event.message === "string"
        ? event.message
        : "stream error";
    handlers.onError(new Error(message));
    finish();
  });

  es.addEventListener("close", () => {
    handlers.onDone();
    finish();
  });

  return finish;
}
