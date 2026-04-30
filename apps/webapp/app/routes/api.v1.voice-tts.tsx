/**
 * ElevenLabs TTS proxy.
 *
 * The voice widget posts each sentence to this endpoint. We:
 *   1. Read the user's TTS provider preference from `user.metadata`.
 *      If they're on Apple → return 204 so the widget falls back to
 *      the local Swift TTS helper.
 *   2. Otherwise call ElevenLabs `text-to-speech/{voice_id}` with
 *      `eleven_flash_v2_5` (lowest first-byte latency in their lineup)
 *      and stream the MP3 back to the client.
 *
 * Keeps the API key server-side; the desktop widget never sees it.
 */

import { type ActionFunctionArgs } from "@remix-run/node";
import { z } from "zod";

import { requireUser } from "~/services/session.server";
import { logger } from "~/services/logger.service";
import { resolveElevenLabsKey } from "~/services/voice-tts.server";

const BodySchema = z.object({
  text: z.string().min(1),
});

const DEFAULT_VOICE_ID = "JBFqnCBsd6RMkjVDRZzb"; // "George" — calm, neutral
const MODEL_ID = "eleven_flash_v2_5";

export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method !== "POST") {
    return new Response("method not allowed", { status: 405 });
  }

  const user = await requireUser(request);
  const metadata = (user.metadata as Record<string, unknown> | null) ?? {};
  const provider = (metadata.ttsProvider as string | undefined) ?? "apple";

  if (provider !== "elevenlabs") {
    // Apple-side TTS — widget will fall back to the local Swift helper.
    return new Response(null, { status: 204 });
  }

  const apiKey = user.workspaceId
    ? await resolveElevenLabsKey(user.workspaceId)
    : null;
  if (!apiKey) {
    logger.warn(
      "[voice-tts] no ElevenLabs key configured; falling back to Apple",
    );
    return new Response(null, { status: 204 });
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return new Response("invalid json", { status: 400 });
  }
  const body = BodySchema.safeParse(raw);
  if (!body.success) {
    return new Response(JSON.stringify(body.error.flatten()), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const voiceId =
    (metadata.elevenLabsVoiceId as string | undefined) || DEFAULT_VOICE_ID;

  const upstream = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
    {
      method: "POST",
      headers: {
        "xi-api-key": apiKey,
        "Content-Type": "application/json",
        Accept: "audio/mpeg",
      },
      body: JSON.stringify({
        text: body.data.text,
        model_id: MODEL_ID,
        voice_settings: { stability: 0.5, similarity_boost: 0.75 },
      }),
    },
  );

  if (!upstream.ok) {
    const errorText = await upstream.text().catch(() => "(no body)");
    logger.error("[voice-tts] ElevenLabs upstream error", {
      status: upstream.status,
      body: errorText.slice(0, 500),
    });
    // 502 is the right code here, but the widget treats anything non-200
    // as "fall back to Apple" — keep it consistent.
    return new Response(null, { status: 502 });
  }

  // Stream the MP3 straight through. The widget plays it via <audio>.
  return new Response(upstream.body, {
    status: 200,
    headers: {
      "Content-Type": "audio/mpeg",
      // Don't let proxies cache; the same text + same voice will produce
      // the same audio anyway, but the user might switch voices mid-session.
      "Cache-Control": "no-store",
    },
  });
};

export const loader = () => new Response("method not allowed", { status: 405 });
