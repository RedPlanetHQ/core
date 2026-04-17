import { type LoaderFunctionArgs } from "@remix-run/node";
import { UI_MESSAGE_STREAM_HEADERS } from "ai";
import { requireUserId } from "~/services/session.server";
import { prisma } from "~/db.server";
import { getResumableStreamContext } from "~/bullmq/connection";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const userId = await requireUserId(request);
  const conversationId = params.streamId;

  if (!conversationId) {
    return new Response(null, { status: 400 });
  }

  const conversation = await prisma.conversation.findFirst({
    where: { id: conversationId, userId, deleted: null },
    select: { activeStreamId: true },
  });

  if (!conversation?.activeStreamId) {
    return new Response(null, { status: 204 });
  }

  const ctx = getResumableStreamContext();
  const stream = await ctx.resumeExistingStream(conversation.activeStreamId);

  if (!stream) {
    return new Response(null, { status: 204 });
  }

  return new Response(stream as any, { headers: UI_MESSAGE_STREAM_HEADERS });
}
