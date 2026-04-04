import { json, type LoaderFunctionArgs, type ActionFunctionArgs } from "@remix-run/node";
import { requireUserId } from "~/services/auth.server";
import { prisma } from "~/db.server";

export async function loader({ request, params }: LoaderFunctionArgs) {
  await requireUserId(request);

  const pageId = params.pageId;
  if (!pageId) return json({ error: "Missing pageId" }, { status: 400 });

  const comments = await prisma.butlerComment.findMany({
    where: { pageId, resolved: false },
    select: {
      id: true,
      selectedText: true,
      content: true,
      conversationId: true,
      createdAt: true,
      resolved: true,
    },
    orderBy: { createdAt: "asc" },
  });

  return json({ comments });
}

/** PATCH /api/v1/page/:pageId/comments — resolve/unresolve by conversationId */
export async function action({ request, params }: ActionFunctionArgs) {
  await requireUserId(request);

  if (request.method !== "PATCH") {
    return json({ error: "Method not allowed" }, { status: 405 });
  }

  const pageId = params.pageId;
  if (!pageId) return json({ error: "Missing pageId" }, { status: 400 });

  const { conversationId, resolved } = await request.json() as {
    conversationId: string;
    resolved: boolean;
  };

  await prisma.butlerComment.updateMany({
    where: { pageId, conversationId },
    data: {
      resolved,
      resolvedAt: resolved ? new Date() : null,
    },
  });

  return json({ ok: true });
}
