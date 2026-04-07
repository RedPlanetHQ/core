import { json, type ActionFunctionArgs } from "@remix-run/node";
import { z } from "zod";
import { env } from "~/env.server";
import { tagConversationOnParagraphs } from "~/services/hocuspocus/content.server";

const BodySchema = z.object({
  fragmentIndices: z.array(z.number().int()),
  conversationId: z.string().min(1),
});

export async function action({ request, params }: ActionFunctionArgs) {
  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, { status: 405 });
  }

  const secret = request.headers.get("Authorization")?.replace("Bearer ", "");
  if (!secret || secret !== env.SESSION_SECRET) {
    return json({ error: "Unauthorized" }, { status: 401 });
  }

  const pageId = params.pageId;
  if (!pageId) {
    return json({ error: "Missing pageId" }, { status: 400 });
  }

  const body = await request.json().catch(() => null);
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return json({ error: parsed.error.message }, { status: 400 });
  }

  const { fragmentIndices, conversationId } = parsed.data;

  await tagConversationOnParagraphs(pageId, fragmentIndices, conversationId);

  return json({ ok: true });
}
