import { createAudioPlayer, type AudioPlayer } from "expo-audio";
import * as FileSystem from "expo-file-system";
import * as Speech from "expo-speech";

import { CORE_API_URL } from "./config";

/**
 * Sentence-level TTS with ElevenLabs → Apple fallback.
 *
 * `speakSentence` enqueues each sentence; the queue plays one at a time so
 * audio doesn't overlap. For each sentence we POST to /api/v1/voice-tts:
 *   - 200 + audio/mpeg → play the MP3 via expo-audio
 *   - 204 (Apple preference / no key) → sticky-fall-back to expo-speech for
 *     this and all subsequent sentences
 *   - non-2xx → fall back to expo-speech for this sentence only
 *
 * `whenIdle(cb)` fires when the queue drains — used by VoiceScreen to flip
 * status back to "idle" after the assistant finishes speaking.
 */

type Job = () => Promise<void>;

const queue: Job[] = [];
let processing = false;
let currentPlayer: AudioPlayer | null = null;
let provider: "unknown" | "apple" | "elevenlabs" = "unknown";
let idleCallback: (() => void) | null = null;

export function speakSentence(token: string, text: string): void {
  queue.push(async () => {
    if (provider === "apple") {
      await speakApple(text);
      return;
    }
    const played = await tryElevenLabs(token, text);
    if (!played) await speakApple(text);
  });
  void processQueue();
}

export function whenIdle(cb: () => void): void {
  if (!processing && queue.length === 0) {
    cb();
    return;
  }
  idleCallback = cb;
}

export async function stopSpeaking(): Promise<void> {
  queue.length = 0;
  idleCallback = null;
  Speech.stop();
  if (currentPlayer) {
    try {
      currentPlayer.pause();
      currentPlayer.remove();
    } catch {
      /* player may already be removed */
    }
    currentPlayer = null;
  }
}

async function processQueue(): Promise<void> {
  if (processing) return;
  processing = true;
  while (queue.length) {
    const next = queue.shift();
    if (!next) break;
    try {
      await next();
    } catch {
      /* keep draining on per-sentence error */
    }
  }
  processing = false;
  const cb = idleCallback;
  idleCallback = null;
  cb?.();
}

async function tryElevenLabs(token: string, text: string): Promise<boolean> {
  try {
    const res = await fetch(`${CORE_API_URL}/api/v1/voice-tts`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ text }),
    });
    if (res.status === 204) {
      provider = "apple";
      return false;
    }
    if (!res.ok) return false;

    provider = "elevenlabs";
    const buffer = await res.arrayBuffer();
    await playMp3(buffer);
    return true;
  } catch {
    return false;
  }
}

async function playMp3(buffer: ArrayBuffer): Promise<void> {
  const base64 = arrayBufferToBase64(buffer);
  const path = `${FileSystem.cacheDirectory}tts-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.mp3`;
  await FileSystem.writeAsStringAsync(path, base64, {
    encoding: FileSystem.EncodingType.Base64,
  });

  const player = createAudioPlayer({ uri: path });
  currentPlayer = player;

  await new Promise<void>((resolve) => {
    const sub = player.addListener("playbackStatusUpdate", (status) => {
      if (status.didJustFinish) {
        sub.remove();
        resolve();
      }
    });
    player.play();
  });

  try {
    player.remove();
  } catch {
    /* already removed */
  }
  currentPlayer = null;
  await FileSystem.deleteAsync(path, { idempotent: true });
}

function speakApple(text: string): Promise<void> {
  return new Promise((resolve) => {
    Speech.speak(text, {
      language: "en-US",
      onDone: () => resolve(),
      onStopped: () => resolve(),
      onError: () => resolve(),
    });
  });
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode.apply(null, Array.from(chunk));
  }
  const anyGlobal = globalThis as { btoa?: (s: string) => string };
  return anyGlobal.btoa ? anyGlobal.btoa(binary) : "";
}
