/**
 * BYOK endpoint for the ElevenLabs API key.
 *
 *   POST   { apiKey } → store encrypted on workspace metadata
 *   DELETE              → wipe it
 *
 * The proxy at /api/v1/voice-tts then prefers the workspace key over
 * the server-wide ELEVENLABS_API_KEY env var.
 */

import {
  json,
  type ActionFunctionArgs,
  type LoaderFunctionArgs,
} from "@remix-run/node";
import { z } from "zod";

import { requireUser } from "~/services/session.server";
import {
  setWorkspaceElevenLabsKey,
  clearWorkspaceElevenLabsKey,
} from "~/services/voice-tts.server";

const PostBody = z.object({ apiKey: z.string().min(1) });

export const action = async ({ request }: ActionFunctionArgs) => {
  const user = await requireUser(request);
  if (!user.workspaceId) {
    return json({ error: "Workspace not found" }, { status: 404 });
  }

  if (request.method === "DELETE") {
    await clearWorkspaceElevenLabsKey(user.workspaceId);
    return json({ ok: true });
  }

  if (request.method !== "POST") {
    return new Response("method not allowed", { status: 405 });
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return new Response("invalid json", { status: 400 });
  }
  const parsed = PostBody.safeParse(raw);
  if (!parsed.success) {
    return json(
      { error: "Invalid request", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  await setWorkspaceElevenLabsKey(user.workspaceId, parsed.data.apiKey);
  return json({ ok: true });
};

export const loader = (_args: LoaderFunctionArgs) =>
  new Response("method not allowed", { status: 405 });
