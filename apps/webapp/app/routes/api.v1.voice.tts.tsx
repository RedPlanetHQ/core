/**
 * Text-to-speech proxy.
 *
 * Reads the user's `ttsProvider` preference and dispatches through the
 * provider registry in `voice-tts.server.ts`.
 *
 * Behaviour:
 *   - "apple" (local Tauri Swift) → 204, client uses its local helper.
 *   - Cloud provider + no credential configured → 204, same fallback so
 *     audio never goes silent on the client (clients treat anything
 *     non-200 as "play locally"). We log a warning server-side.
 *   - Cloud provider + credential → stream the audio bytes through.
 *
 * Accepts session-cookie auth (webapp / desktop) or Bearer PAT / OAuth2
 * token (mobile + CLI) via `authenticateHybridRequest`.
 */

import { type ActionFunctionArgs } from "@remix-run/node";
import { z } from "zod";

import { logger } from "~/services/logger.service";
import { getUserById } from "~/models/user.server";
import { authenticateHybridRequest } from "~/services/routeBuilders/apiBuilder.server";
import { resolveTTSProvider, TTSError } from "~/services/voice-tts.server";

const BodySchema = z.object({
  text: z.string().min(1),
});

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
  // `?provider=` is still honored for power users / debug, but the
  // normal browser path doesn't need it any more — the X-Voice-Context
  // header below tells the server "I have no local synth, pick cloud
  // for me" and the resolver finds an available provider.
  const explicitProvider = new URL(request.url).searchParams.get("provider");
  // Callers that have no local synth (in-page voice mode in the
  // browser) send this header so the resolver can prefer a cloud
  // provider when the saved choice is Apple.
  const needsCloud =
    request.headers.get("x-voice-context")?.toLowerCase() === "browser";

  if (!auth.workspaceId) {
    return new Response(null, { status: 204 });
  }

  const resolution = await resolveTTSProvider({
    workspaceId: auth.workspaceId,
    userMetadata: metadata,
    explicitProviderId: explicitProvider,
    needsCloud,
  });

  if (resolution.kind === "local") {
    // Local synth — client (Tauri) handles it. Browser callers would
    // have sent `needsCloud` and never landed here.
    return new Response(null, { status: 204 });
  }

  if (resolution.kind === "unavailable") {
    // No cloud provider with creds AND caller can't fall back to
    // local. Be explicit so the client can prompt the user to set
    // up their key.
    return new Response(
      JSON.stringify({
        error: "needs-config",
        message:
          "No configured cloud TTS provider — add an ElevenLabs key in Voice settings.",
      }),
      {
        status: 412,
        headers: { "Content-Type": "application/json" },
      },
    );
  }

  const { providerId, provider } = resolution;

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

  try {
    const stream = await provider.synthesize({
      workspaceId: auth.workspaceId,
      text: body.data.text,
      userMetadata: metadata,
    });
    return new Response(stream.body, {
      status: 200,
      headers: {
        "Content-Type": stream.contentType,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    if (err instanceof TTSError) {
      if (err.code === "needs-config") {
        // When the caller can't fall back to local (browser), tell
        // them honestly so they can prompt the user to configure
        // their key. Otherwise keep the 204 "play locally" contract.
        if (needsCloud || explicitProvider) {
          return new Response(
            JSON.stringify({
              error: "needs-config",
              message: err.message,
              provider: providerId,
            }),
            {
              status: 412,
              headers: { "Content-Type": "application/json" },
            },
          );
        }
        logger.warn(
          "[voice-tts] provider unconfigured; falling back to local",
          { providerId, message: err.message },
        );
        return new Response(null, { status: 204 });
      }
      if (err.code === "invalid-input") {
        return new Response(err.message, { status: 400 });
      }
      return new Response(null, { status: 502 });
    }
    logger.error("[voice-tts] unexpected synthesis failure", {
      err: String(err),
    });
    return new Response(null, { status: 502 });
  }
};

export const loader = () => new Response("method not allowed", { status: 405 });
