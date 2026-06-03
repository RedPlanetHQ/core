/**
 * Speech-to-text proxy.
 *
 * POST multipart with a `file` (audio blob) and optional `provider`.
 * Routes through `voice-stt.server.ts` to the user's chosen provider
 * (defaults to `user.metadata.sttProvider`, falling back to "elevenlabs").
 *
 * Local providers (e.g. Apple via Tauri Swift) never hit this route —
 * the client produces the transcript locally and skips the network.
 *
 * Responses:
 *   200 { text, language, containedEvents } → success. `text` is the
 *        cleaned transcript with non-speech audio-event tags (e.g.
 *        "(background music)") stripped; `containedEvents` is true
 *        when such tags were present.
 *   401                                  → unauth
 *   412 { error: "needs-config", provider } → no API key configured
 *   502                                  → upstream provider error
 */

import {
  unstable_parseMultipartFormData,
  unstable_createMemoryUploadHandler,
  type ActionFunctionArgs,
} from "@remix-run/node";

import { logger } from "~/services/logger.service";
import { getUserById } from "~/models/user.server";
import { authenticateHybridRequest } from "~/services/routeBuilders/apiBuilder.server";
import { getSTTProvider, STTError } from "~/services/voice-stt.server";

// 25 MB — ElevenLabs Scribe accepts up to ~1GB but we don't want
// rogue clients streaming long uploads. 25 MB ≈ 25 min of opus@128kbps.
const MAX_AUDIO_BYTES = 25 * 1024 * 1024;

export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method !== "POST") {
    return new Response("method not allowed", { status: 405 });
  }

  const auth = await authenticateHybridRequest(request, { allowJWT: true });
  if (!auth?.ok) {
    return new Response("unauthorized", { status: 401 });
  }
  if (!auth.workspaceId) {
    return new Response("workspace required", { status: 400 });
  }

  const user = await getUserById(auth.userId);
  if (!user) {
    return new Response("unauthorized", { status: 401 });
  }

  const metadata = (user.metadata as Record<string, unknown> | null) ?? {};
  const explicitProvider = new URL(request.url).searchParams.get("provider");
  const persistedProvider =
    (metadata.sttProvider as string | undefined) ?? "elevenlabs";
  const providerId = explicitProvider || persistedProvider;

  const provider = getSTTProvider(providerId);
  if (!provider) {
    return jsonError(
      400,
      "unknown-provider",
      `provider "${providerId}" is not a registered STT provider`,
    );
  }

  let form: FormData;
  try {
    form = await unstable_parseMultipartFormData(
      request,
      unstable_createMemoryUploadHandler({ maxPartSize: MAX_AUDIO_BYTES }),
    );
  } catch (err) {
    logger.warn("[voice-stt] failed to parse multipart", { err: String(err) });
    return jsonError(400, "invalid-input", "invalid multipart payload");
  }

  const file = form.get("file");
  if (!(file instanceof Blob) || file.size === 0) {
    return jsonError(400, "invalid-input", "missing `file` blob");
  }

  // Language hint: explicit `?language=` wins, else user's saved
  // sttLanguage. Empty / "auto" / undefined → let the provider
  // auto-detect.
  const explicitLanguage = new URL(request.url).searchParams.get("language");
  const savedLanguage = (metadata.sttLanguage as string | undefined) ?? "";
  const language = explicitLanguage ?? savedLanguage;
  const effectiveLanguage =
    !language || language === "auto" ? null : language;

  try {
    const result = await provider.transcribe({
      workspaceId: auth.workspaceId,
      audio: file,
      filename: file instanceof File ? file.name : undefined,
      language: effectiveLanguage,
    });
    return new Response(
      JSON.stringify({
        text: result.text,
        language: result.language ?? null,
        containedEvents: result.containedEvents ?? false,
      }),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "no-store",
        },
      },
    );
  } catch (err) {
    if (err instanceof STTError) {
      if (err.code === "needs-config") {
        return jsonError(
          412,
          "needs-config",
          err.message,
          { provider: provider.id },
        );
      }
      if (err.code === "invalid-input") {
        return jsonError(400, "invalid-input", err.message);
      }
      return jsonError(502, "upstream", err.message);
    }
    logger.error("[voice-stt] unexpected transcribe failure", {
      err: String(err),
    });
    return jsonError(500, "internal", "transcription failed");
  }
};

export const loader = () => new Response("method not allowed", { status: 405 });

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
