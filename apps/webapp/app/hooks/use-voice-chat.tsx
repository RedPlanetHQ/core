/**
 * In-page voice chat hook.
 *
 * Two recording paths, picked by provider:
 *   - "apple" (Tauri only): defers to the existing Swift recognizer
 *     via `voice_start_dictation` / `voice_stop_dictation`. Live
 *     partials stream over the `dictation:partial` Tauri event; the
 *     finalized transcript arrives on `dictation:final`.
 *   - Anything else (currently "elevenlabs"): captures audio with
 *     MediaRecorder, uploads on stop to `/api/v1/voice/stt`, surfaces
 *     the returned text.
 *
 * The hook is intentionally provider-agnostic at the UI seam. Callers
 * pass an optional `provider` to override the runtime default
 * (`apple` in Tauri, `elevenlabs` in the browser); they get back a
 * uniform { status, partial, error, start, stop, cancel } shape.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import {
  defaultSTTProvider,
  type STTProviderId,
} from "~/components/voice/stt-providers";
import { isTauri, tauriInvoke, tauriListen } from "~/lib/tauri.client";

export type VoiceChatStatus =
  | "idle"
  | "starting"
  | "recording"
  | "transcribing"
  | "error";

export type VoiceChatErrorCode =
  | "needs-config"
  | "no-mic"
  | "no-permission"
  | "no-audio"
  | "upstream"
  | "unknown";

export interface VoiceChatError {
  code: VoiceChatErrorCode;
  message: string;
  /** STT provider id that produced the error — useful for "configure X" CTAs. */
  provider: STTProviderId;
}

export interface UseVoiceChatOptions {
  /** Override the runtime default. */
  provider?: STTProviderId;
  /** Called with the final transcript when recording stops. */
  onResult?: (text: string) => void;
  /** Called on any failure path. */
  onError?: (err: VoiceChatError) => void;
}

export interface UseVoiceChatReturn {
  status: VoiceChatStatus;
  partial: string;
  error: VoiceChatError | null;
  provider: STTProviderId;
  start: () => Promise<void>;
  stop: () => Promise<void>;
  cancel: () => void;
}

// Anything shorter than this is almost certainly the user accidentally
// tapping the mic button; bail before charging an STT call.
const MIN_RECORDING_MS = 250;

export function useVoiceChat(
  opts: UseVoiceChatOptions = {},
): UseVoiceChatReturn {
  const runtimeIsTauri = isTauriClient();
  const provider: STTProviderId =
    opts.provider ?? defaultSTTProvider({ isTauri: runtimeIsTauri });

  const [status, setStatus] = useState<VoiceChatStatus>("idle");
  const [partial, setPartial] = useState("");
  const [error, setError] = useState<VoiceChatError | null>(null);

  // Apple path
  const appleUnsubsRef = useRef<Array<() => void>>([]);

  // MediaRecorder path
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startedAtRef = useRef<number>(0);
  const cancelledRef = useRef<boolean>(false);

  const onResultRef = useRef(opts.onResult);
  const onErrorRef = useRef(opts.onError);
  onResultRef.current = opts.onResult;
  onErrorRef.current = opts.onError;

  const fail = useCallback((err: VoiceChatError) => {
    setError(err);
    setStatus("error");
    setPartial("");
    onErrorRef.current?.(err);
  }, []);

  const finish = useCallback((text: string) => {
    setStatus("idle");
    setPartial("");
    setError(null);
    onResultRef.current?.(text);
  }, []);

  const teardownApple = useCallback(() => {
    const list = appleUnsubsRef.current;
    appleUnsubsRef.current = [];
    list.forEach((u) => {
      try {
        u();
      } catch {
        // ignore
      }
    });
  }, []);

  const teardownRecorder = useCallback(() => {
    const rec = recorderRef.current;
    recorderRef.current = null;
    if (rec && rec.state !== "inactive") {
      try {
        rec.stop();
      } catch {
        // ignore
      }
    }
    const stream = streamRef.current;
    streamRef.current = null;
    if (stream) {
      stream.getTracks().forEach((t) => t.stop());
    }
    chunksRef.current = [];
  }, []);

  // Cleanup on unmount.
  useEffect(
    () => () => {
      teardownApple();
      teardownRecorder();
    },
    [teardownApple, teardownRecorder],
  );

  const startApple = useCallback(async () => {
    setStatus("starting");
    setPartial("");
    setError(null);
    try {
      const partialUnsub = await tauriListen<{ text: string }>(
        "dictation:partial",
        (event) => {
          setPartial(event.payload?.text ?? "");
        },
      );
      const finalUnsub = await tauriListen<{ text: string }>(
        "dictation:final",
        (event) => {
          const text = (event.payload?.text ?? "").trim();
          teardownApple();
          finish(text);
        },
      );
      const errorUnsub = await tauriListen<{ message: string }>(
        "dictation:error",
        (event) => {
          teardownApple();
          fail({
            code: "unknown",
            message: event.payload?.message ?? "dictation failed",
            provider: "apple",
          });
        },
      );
      appleUnsubsRef.current = [partialUnsub, finalUnsub, errorUnsub];

      await tauriInvoke("voice_start_dictation");
      setStatus("recording");
    } catch (err) {
      teardownApple();
      fail({
        code: "unknown",
        message: String(err) || "failed to start dictation",
        provider: "apple",
      });
    }
  }, [fail, finish, teardownApple]);

  const stopApple = useCallback(async () => {
    if (status !== "recording") return;
    setStatus("transcribing");
    try {
      await tauriInvoke("voice_stop_dictation");
      // dictation:final handler will move state to idle.
    } catch (err) {
      teardownApple();
      fail({
        code: "unknown",
        message: String(err) || "failed to stop dictation",
        provider: "apple",
      });
    }
  }, [fail, status, teardownApple]);

  const startRecorder = useCallback(async () => {
    if (typeof navigator === "undefined" || !navigator.mediaDevices) {
      fail({
        code: "no-mic",
        message: "microphone API unavailable in this environment",
        provider,
      });
      return;
    }
    setStatus("starting");
    setPartial("");
    setError(null);
    cancelledRef.current = false;

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      const name = (err as { name?: string })?.name ?? "";
      fail({
        code:
          name === "NotAllowedError" || name === "SecurityError"
            ? "no-permission"
            : "no-mic",
        message: `microphone access denied: ${String(err)}`,
        provider,
      });
      return;
    }
    streamRef.current = stream;

    const mime = pickSupportedMime();
    let rec: MediaRecorder;
    try {
      rec = mime
        ? new MediaRecorder(stream, { mimeType: mime })
        : new MediaRecorder(stream);
    } catch (err) {
      teardownRecorder();
      fail({
        code: "no-mic",
        message: `MediaRecorder failed: ${String(err)}`,
        provider,
      });
      return;
    }
    recorderRef.current = rec;
    chunksRef.current = [];

    rec.addEventListener("dataavailable", (e) => {
      if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
    });

    rec.addEventListener("stop", async () => {
      // Free the mic immediately — we don't need it during upload.
      const stream = streamRef.current;
      streamRef.current = null;
      if (stream) stream.getTracks().forEach((t) => t.stop());

      if (cancelledRef.current) {
        chunksRef.current = [];
        return;
      }

      const elapsed = Date.now() - startedAtRef.current;
      const blobType = mime || chunksRef.current[0]?.type || "audio/webm";
      const blob = new Blob(chunksRef.current, { type: blobType });
      chunksRef.current = [];

      if (elapsed < MIN_RECORDING_MS || blob.size === 0) {
        fail({
          code: "no-audio",
          message: "recording too short to transcribe",
          provider,
        });
        return;
      }

      setStatus("transcribing");
      try {
        const form = new FormData();
        const ext = filenameExtensionFor(blobType);
        form.append("file", blob, `recording.${ext}`);
        const res = await fetch(`/api/v1/voice/stt?provider=${provider}`, {
          method: "POST",
          credentials: "include",
          body: form,
        });
        if (!res.ok) {
          if (res.status === 412) {
            const body = (await safeJson(res)) as
              | { message?: string }
              | null;
            fail({
              code: "needs-config",
              message: body?.message ?? "provider not configured",
              provider,
            });
            return;
          }
          fail({
            code: "upstream",
            message: `voice-stt ${res.status}`,
            provider,
          });
          return;
        }
        const data = (await safeJson(res)) as { text?: string } | null;
        finish((data?.text ?? "").trim());
      } catch (err) {
        fail({
          code: "upstream",
          message: String(err),
          provider,
        });
      }
    });

    startedAtRef.current = Date.now();
    try {
      rec.start();
      setStatus("recording");
    } catch (err) {
      teardownRecorder();
      fail({
        code: "no-mic",
        message: `MediaRecorder.start failed: ${String(err)}`,
        provider,
      });
    }
  }, [fail, finish, provider, teardownRecorder]);

  const stopRecorder = useCallback(async () => {
    const rec = recorderRef.current;
    if (!rec || rec.state === "inactive") return;
    try {
      rec.stop();
    } catch {
      // 'stop' handler still runs even if it threw — let it finalize.
    }
  }, []);

  const start = useCallback(async () => {
    if (status !== "idle" && status !== "error") return;
    if (provider === "apple") {
      await startApple();
    } else {
      await startRecorder();
    }
  }, [provider, startApple, startRecorder, status]);

  const stop = useCallback(async () => {
    if (provider === "apple") {
      await stopApple();
    } else {
      await stopRecorder();
    }
  }, [provider, stopApple, stopRecorder]);

  const cancel = useCallback(() => {
    cancelledRef.current = true;
    if (provider === "apple") {
      void tauriInvoke("voice_cancel_dictation").catch(() => {});
      teardownApple();
    } else {
      teardownRecorder();
    }
    setStatus("idle");
    setPartial("");
    setError(null);
  }, [provider, teardownApple, teardownRecorder]);

  return { status, partial, error, provider, start, stop, cancel };
}

function isTauriClient(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return isTauri();
  } catch {
    return false;
  }
}

function pickSupportedMime(): string | null {
  if (typeof MediaRecorder === "undefined") return null;
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/ogg;codecs=opus",
    "audio/mp4",
  ];
  for (const m of candidates) {
    try {
      if (MediaRecorder.isTypeSupported(m)) return m;
    } catch {
      // ignore
    }
  }
  return null;
}

function filenameExtensionFor(mime: string): string {
  if (mime.includes("webm")) return "webm";
  if (mime.includes("ogg")) return "ogg";
  if (mime.includes("mp4")) return "mp4";
  if (mime.includes("mpeg")) return "mp3";
  if (mime.includes("wav")) return "wav";
  return "audio";
}

async function safeJson(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}
