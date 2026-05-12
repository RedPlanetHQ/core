/**
 * ElevenLabs TTS proxy.
 *
 * Accepts session-cookie auth (webapp / desktop webview) OR Bearer PAT /
 * OAuth2 token (mobile + CLI) via `authenticateHybridRequest`. Behaviour:
 *
 *   1. Read the user's TTS provider preference from `user.metadata`.
 *      If they're on Apple → return 204 so the client falls back to its
 *      local TTS helper.
 *   2. Otherwise call ElevenLabs `text-to-speech/{voice_id}` with
 *      `eleven_flash_v2_5` (lowest first-byte latency in their lineup)
 *      and stream the MP3 back to the client.
 *
 * The API key never leaves the server.
 */

import { type ActionFunctionArgs } from "@remix-run/node";
import { z } from "zod";

import { logger } from "~/services/logger.service";
import { getUserById } from "~/models/user.server";
import { authenticateHybridRequest } from "~/services/routeBuilders/apiBuilder.server";
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

  const auth = await authenticateHybridRequest(request, { allowJWT: true });
  if (!auth?.ok) {
    return new Response("unauthorized", { status: 401 });
  }

  const user = await getUserById(auth.userId);
  if (!user) {
    return new Response("unauthorized", { status: 401 });
  }

  const metadata = (user.metadata as Record<string, unknown> | null) ?? {};
  const provider = (metadata.ttsProvider as string | undefined) ?? "apple";

  if (provider !== "elevenlabs") {
    // Apple-side TTS — client falls back to its local synthesizer.
    return new Response(null, { status: 204 });
  }

  const workspaceId = auth.workspaceId;
  const apiKey = workspaceId ? await resolveElevenLabsKey(workspaceId) : null;
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
    // 502 is the right code here, but clients treat anything non-200 as
    // "fall back to local TTS" — keep it consistent across providers.
    return new Response(null, { status: 502 });
  }

  // Stream the MP3 straight through. Clients play it via <audio> or expo-av.
  return new Response(upstream.body, {
    status: 200,
    headers: {
      "Content-Type": "audio/mpeg",
      "Cache-Control": "no-store",
    },
  });
};

export const loader = () => new Response("method not allowed", { status: 405 });
