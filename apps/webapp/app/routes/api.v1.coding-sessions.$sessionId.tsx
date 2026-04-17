import { json } from "@remix-run/node";
import type { ActionFunctionArgs } from "@remix-run/node";
import { z } from "zod";
import { requireUser, getWorkspaceId } from "~/services/session.server";
import { updateCodingSessionExternalId } from "~/services/coding/coding-session.server";

const PatchSchema = z.object({
  externalSessionId: z.string().min(1),
});

export async function action({ request, params }: ActionFunctionArgs) {
  if (request.method !== "PATCH") {
    return json({ error: "Method not allowed" }, { status: 405 });
  }

  const user = await requireUser(request);
  const workspaceId = (await getWorkspaceId(
    request,
    user.id,
    user.workspaceId,
  )) as string;

  const { sessionId } = params;
  if (!sessionId) return json({ error: "Missing sessionId" }, { status: 400 });

  const body = await request.json().catch(() => ({}));
  const parsed = PatchSchema.safeParse(body);
  if (!parsed.success) {
    return json({ error: parsed.error.message }, { status: 400 });
  }

  try {
    await updateCodingSessionExternalId(
      sessionId,
      workspaceId,
      parsed.data.externalSessionId,
    );
    return json({ ok: true });
  } catch {
    return json({ error: "Session not found or access denied" }, { status: 403 });
  }
}
