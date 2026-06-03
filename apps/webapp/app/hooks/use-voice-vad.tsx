/**
 * Voice activity detection-driven STT loop.
 *
 * Opens the mic once, watches the audio RMS in a rAF loop, and runs a
 * small state machine:
 *
 *   waiting    — mic open, no speech yet. Silent levels.
 *   recording  — speech onset detected; MediaRecorder is capturing.
 *   transcribing — trailing silence triggered an upload; waiting for
 *                  /api/v1/voice/stt to return text.
 *
 * After each transcribe we drop back to `waiting` so the user can keep
 * talking in a continuous conversation without clicking anything.
 *
 * Tuned for browser MediaRecorder + ElevenLabs Scribe. Apple Swift
 * dictation has its own endpointing in the Tauri helper, so this hook
 * stays in the browser path (works fine inside the Tauri webview too).
 */

import { useCallback, useEffect, useRef, useState } from "react";

import type { STTProviderId } from "~/components/voice/stt-providers";

export type VoiceVadStatus =
  | "off"
  | "starting"
  | "waiting"
  | "recording"
  | "transcribing"
  | "error";

export type VoiceVadErrorCode =
  | "no-mic"
  | "no-permission"
  | "needs-config"
  | "upstream"
  | "unknown";

export interface VoiceVadError {
  code: VoiceVadErrorCode;
  message: string;
  provider: STTProviderId;
}

export interface VoiceVadTurnResult {
  /** Cleaned transcript — empty if the turn contained only noise. */
  text: string;
  /** True if the provider returned non-speech audio-event tags. */
  containedEvents: boolean;
}

export interface UseVoiceVadOptions {
  enabled: boolean;
  /** Fires only for non-empty cleaned transcripts. */
  onTranscript: (text: string) => void;
  onError?: (err: VoiceVadError) => void;
  provider?: STTProviderId;
  /**
   * Fires when audio crosses the speech threshold (waiting → recording).
   * Use this for instant barge-in feedback like ducking TTS playback,
   * before we know whether the turn is real speech or just noise.
   */
  onSpeechOnset?: () => void;
  /**
   * Fires once per finished turn with the cleaned transcript and an
   * `containedEvents` flag. Lets callers decide what to do for
   * events-only turns — e.g. restore ducked TTS without sending a
   * message.
   */
  onTurnResult?: (result: VoiceVadTurnResult) => void;
  /** RMS above this triggers "speech onset". 0 – 1, default 0.025. */
  speechThreshold?: number;
  /** RMS below this counts as silence. 0 – 1, default 0.012. */
  silenceThreshold?: number;
  /** Trailing silence required to end a turn. Default 1200ms. */
  silenceMs?: number;
  /** Minimum recording duration before we'll allow stopping. Default 350ms. */
  minRecordingMs?: number;
}

export interface UseVoiceVadReturn {
  status: VoiceVadStatus;
  /** 0-1 RMS level, smoothed — for visualizing input intensity. */
  level: number;
  error: VoiceVadError | null;
  provider: STTProviderId;
}

const DEFAULTS = {
  speechThreshold: 0.025,
  silenceThreshold: 0.012,
  silenceMs: 1200,
  minRecordingMs: 350,
};

export function useVoiceVad({
  enabled,
  onTranscript,
  onError,
  provider,
  onSpeechOnset,
  onTurnResult,
  speechThreshold = DEFAULTS.speechThreshold,
  silenceThreshold = DEFAULTS.silenceThreshold,
  silenceMs = DEFAULTS.silenceMs,
  minRecordingMs = DEFAULTS.minRecordingMs,
}: UseVoiceVadOptions): UseVoiceVadReturn {
  // VAD is fundamentally a MediaRecorder-upload pipeline — local
  // providers like Apple aren't a thing here even in Tauri (the Swift
  // recognizer has its own endpointing and is exposed by the
  // dictation hook + the floating widget). So unless the caller
  // explicitly picks a provider, default to the first cloud one.
  const resolvedProvider: STTProviderId = provider ?? "elevenlabs";

  const [status, setStatus] = useState<VoiceVadStatus>("off");
  const [level, setLevel] = useState(0);
  const [error, setError] = useState<VoiceVadError | null>(null);

  // Latest callbacks, so the rAF loop never closes over stale fns.
  const onTranscriptRef = useRef(onTranscript);
  const onErrorRef = useRef(onError);
  const onSpeechOnsetRef = useRef(onSpeechOnset);
  const onTurnResultRef = useRef(onTurnResult);
  onTranscriptRef.current = onTranscript;
  onErrorRef.current = onError;
  onSpeechOnsetRef.current = onSpeechOnset;
  onTurnResultRef.current = onTurnResult;

  // Live state used by the rAF loop. We mirror status into a ref so
  // transitions can be made without re-running the giant setup effect.
  const statusRef = useRef<VoiceVadStatus>("off");
  const setStatusBoth = useCallback((s: VoiceVadStatus) => {
    statusRef.current = s;
    setStatus(s);
  }, []);

  useEffect(() => {
    if (!enabled) {
      setStatusBoth("off");
      setLevel(0);
      setError(null);
      return;
    }

    if (typeof navigator === "undefined" || !navigator.mediaDevices) {
      const err: VoiceVadError = {
        code: "no-mic",
        message: "microphone API unavailable in this environment",
        provider: resolvedProvider,
      };
      setError(err);
      setStatusBoth("error");
      onErrorRef.current?.(err);
      return;
    }

    let cancelled = false;
    let stream: MediaStream | null = null;
    let audioCtx: AudioContext | null = null;
    let analyser: AnalyserNode | null = null;
    let sampleBuf: Float32Array | null = null;
    let rafId: number | null = null;
    let recorder: MediaRecorder | null = null;
    let chunks: Blob[] = [];
    let recordingStartedAt = 0;
    let silenceStartedAt = 0;
    let mimeType: string | null = null;

    const fail = (err: VoiceVadError) => {
      setError(err);
      setStatusBoth("error");
      onErrorRef.current?.(err);
    };

    const stopRecorderAndUpload = () => {
      if (!recorder || recorder.state === "inactive") return;
      setStatusBoth("transcribing");
      try {
        recorder.stop();
      } catch {
        // The "stop" handler still fires — let it finalize.
      }
    };

    const setupRecorder = () => {
      if (!stream) return;
      mimeType = pickSupportedMime();
      try {
        recorder = mimeType
          ? new MediaRecorder(stream, { mimeType })
          : new MediaRecorder(stream);
      } catch (err) {
        fail({
          code: "no-mic",
          message: `MediaRecorder failed: ${String(err)}`,
          provider: resolvedProvider,
        });
        return;
      }

      recorder.addEventListener("dataavailable", (e) => {
        if (e.data && e.data.size > 0) chunks.push(e.data);
      });

      recorder.addEventListener("stop", async () => {
        if (cancelled) return;
        const elapsed = Date.now() - recordingStartedAt;
        const blobType = mimeType || chunks[0]?.type || "audio/webm";
        const blob = new Blob(chunks, { type: blobType });
        chunks = [];

        // Too short → drop and reset; don't bother the STT route.
        // Surface it as an empty turn result so the host can restore
        // any TTS it ducked at speech onset.
        if (elapsed < minRecordingMs || blob.size === 0) {
          onTurnResultRef.current?.({ text: "", containedEvents: false });
          setStatusBoth("waiting");
          return;
        }

        try {
          const form = new FormData();
          const ext = filenameExtensionFor(blobType);
          form.append("file", blob, `recording.${ext}`);
          const res = await fetch(
            `/api/v1/voice/stt?provider=${resolvedProvider}`,
            {
              method: "POST",
              credentials: "include",
              body: form,
            },
          );

          if (cancelled) return;

          if (!res.ok) {
            // Bubble an empty turn result before failing so the host
            // can restore any ducked TTS.
            onTurnResultRef.current?.({ text: "", containedEvents: false });
            if (res.status === 412) {
              const body = (await safeJson(res)) as
                | { message?: string }
                | null;
              fail({
                code: "needs-config",
                message: body?.message ?? "provider not configured",
                provider: resolvedProvider,
              });
              return;
            }
            fail({
              code: "upstream",
              message: `voice-stt ${res.status}`,
              provider: resolvedProvider,
            });
            return;
          }

          const data = (await safeJson(res)) as {
            text?: string;
            containedEvents?: boolean;
          } | null;
          const text = (data?.text ?? "").trim();
          const containedEvents = data?.containedEvents ?? false;
          // Fire the raw turn result first so hosts that ducked TTS at
          // onset can restore (events-only) or flush (real speech) before
          // the message goes out.
          onTurnResultRef.current?.({ text, containedEvents });
          if (text) onTranscriptRef.current?.(text);
          // Resume listening immediately for the next turn.
          if (!cancelled) setStatusBoth("waiting");
        } catch (err) {
          if (cancelled) return;
          onTurnResultRef.current?.({ text: "", containedEvents: false });
          fail({
            code: "upstream",
            message: String(err),
            provider: resolvedProvider,
          });
        }
      });
    };

    const tick = () => {
      if (cancelled || !analyser || !sampleBuf) return;
      analyser.getFloatTimeDomainData(sampleBuf);
      let sum = 0;
      for (let i = 0; i < sampleBuf.length; i++) {
        const v = sampleBuf[i];
        sum += v * v;
      }
      const rms = Math.sqrt(sum / sampleBuf.length);
      // Slight smoothing so the visualization isn't jittery.
      setLevel((prev) => prev * 0.7 + rms * 0.3);

      const now = performance.now();
      const s = statusRef.current;

      if (s === "waiting" && rms > speechThreshold) {
        // Speech onset → start recording.
        if (recorder && recorder.state === "inactive") {
          chunks = [];
          recordingStartedAt = Date.now();
          silenceStartedAt = 0;
          try {
            recorder.start(100);
            setStatusBoth("recording");
            // Fire onset before we know whether it's real speech —
            // lets the host duck TTS for instant feedback.
            onSpeechOnsetRef.current?.();
          } catch {
            // ignore — next tick will try again
          }
        }
      } else if (s === "recording") {
        if (rms < silenceThreshold) {
          if (silenceStartedAt === 0) silenceStartedAt = now;
          else if (
            now - silenceStartedAt > silenceMs &&
            Date.now() - recordingStartedAt > minRecordingMs
          ) {
            silenceStartedAt = 0;
            stopRecorderAndUpload();
          }
        } else {
          silenceStartedAt = 0;
        }
      }

      rafId = requestAnimationFrame(tick);
    };

    (async () => {
      setStatusBoth("starting");
      setError(null);
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        });
      } catch (err) {
        const name = (err as { name?: string })?.name ?? "";
        fail({
          code:
            name === "NotAllowedError" || name === "SecurityError"
              ? "no-permission"
              : "no-mic",
          message: `microphone access denied: ${String(err)}`,
          provider: resolvedProvider,
        });
        return;
      }
      if (cancelled) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }

      // Audio analysis pipeline.
      const Ctor =
        window.AudioContext || (window as any).webkitAudioContext;
      audioCtx = new Ctor();
      const source = audioCtx.createMediaStreamSource(stream);
      analyser = audioCtx.createAnalyser();
      analyser.fftSize = 1024;
      analyser.smoothingTimeConstant = 0.5;
      sampleBuf = new Float32Array(analyser.fftSize);
      source.connect(analyser);

      setupRecorder();
      if (cancelled) return;
      setStatusBoth("waiting");
      rafId = requestAnimationFrame(tick);
    })();

    return () => {
      cancelled = true;
      if (rafId !== null) cancelAnimationFrame(rafId);
      if (recorder && recorder.state !== "inactive") {
        try {
          recorder.stop();
        } catch {
          // ignore
        }
      }
      if (audioCtx) {
        audioCtx.close().catch(() => {});
      }
      if (stream) {
        stream.getTracks().forEach((t) => t.stop());
      }
      setStatusBoth("off");
      setLevel(0);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, resolvedProvider, speechThreshold, silenceThreshold, silenceMs, minRecordingMs]);

  return { status, level, error, provider: resolvedProvider };
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
