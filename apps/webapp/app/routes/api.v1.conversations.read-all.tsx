import { json } from "@remix-run/node";
import { requireUser } from "~/services/session.server";
import { readAllConversations } from "~/services/conversation.server";

export const action = async ({ request }: { request: Request }) => {
  const user = await requireUser(request);
  await readAllConversations(user.id);
  return json({ ok: true });
};
