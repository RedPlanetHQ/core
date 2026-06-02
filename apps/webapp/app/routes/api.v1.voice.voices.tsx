/**
 * Voice catalog endpoint.
 *
 *   GET ?provider=elevenlabs → { voices: TTSVoice[] }
 *   412                        → { error: "needs-config", provider }
 *
 * Reads the user's TTS provider preference when `provider` is omitted.
 * Dispatches through `getTTSProvider()` so adding a new catalog-aware
 * provider doesn't touch this file.
 */

import { type LoaderFunctionArgs } from "@remix-run/node";

import { authenticateHybridRequest } from "~/services/routeBuilders/apiBuilder.server";
import { getUserById } from "~/models/user.server";
import { getTTSProvider, TTSError } from "~/services/voice-tts.server";
import { logger } from "~/services/logger.service";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const auth = await authenticateHybridRequest(request, { allowJWT: true });
  if (!auth?.ok) {
    return new Response("unauthorized", { status: 401 });
  }
  if (!auth.workspaceId) {
    return new Response("workspace required", { status: 400 });
  }

  const user = await getUserById(auth.userId);
  if (!user) return new Response("unauthorized", { status: 401 });
  const metadata = (user.metadata as Record<string, unknown> | null) ?? {};

  const url = new URL(request.url);
  const providerId =
    url.searchParams.get("provider") ??
    (metadata.ttsProvider as string | undefined) ??
    "elevenlabs";

  const provider = getTTSProvider(providerId);
  if (!provider) {
    return jsonError(400, "unknown-provider", `unknown TTS provider`);
  }
  if (!provider.listVoices) {
    return new Response(JSON.stringify({ voices: [] }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const voices = await provider.listVoices(auth.workspaceId);
    return new Response(JSON.stringify({ voices }), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        // Lightweight cache so the picker doesn't re-fetch on every
        // popover open. The catalog rarely changes mid-session.
        "Cache-Control": "private, max-age=60",
      },
    });
  } catch (err) {
    if (err instanceof TTSError) {
      if (err.code === "needs-config") {
        return jsonError(412, "needs-config", err.message, {
          provider: provider.id,
        });
      }
      return jsonError(502, "upstream", err.message);
    }
    logger.error("[voice-tts/voices] unexpected", { err: String(err) });
    return jsonError(500, "internal", "failed to fetch voices");
  }
};

export const action = () =>
  new Response("method not allowed", { status: 405 });

function jsonError(
  status: number,
  error: string,
  message: string,
  extra: Record<string, unknown> = {},
) {
  return new Response(JSON.stringify({ error, message, ...extra }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
