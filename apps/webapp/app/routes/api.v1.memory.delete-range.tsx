import { json, type ActionFunctionArgs } from "@remix-run/node";
import { requireUser } from "~/services/session.server";
import { deleteSession } from "~/services/ingestionLogs.server";
import { deleteDocument } from "~/services/document.server";
import { prisma } from "~/db.server";

function parseDurationMs(value: string, unit: string): number | null {
  const n = parseInt(value, 10);
  if (isNaN(n) || n <= 0) return null;

  switch (unit) {
    case "minutes":
      return n * 60 * 1000;
    case "hours":
      return n * 60 * 60 * 1000;
    case "days":
      return n * 24 * 60 * 60 * 1000;
    default:
      return null;
  }
}

export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, { status: 405 });
  }

  const { id: userId, workspaceId } = await requireUser(request);

  if (!workspaceId) {
    return json({ error: "Workspace not found" }, { status: 404 });
  }

  const body = await request.json();
  const { duration, unit, confirm } = body as {
    duration: string;
    unit: string;
    confirm: string;
  };

  if (confirm !== "delete") {
    return json({ error: "Confirmation text does not match" }, { status: 400 });
  }

  const durationMs = parseDurationMs(duration, unit);
  if (!durationMs) {
    return json({ error: "Invalid duration" }, { status: 400 });
  }

  const since = new Date(Date.now() - durationMs);

  const documents = await prisma.document.findMany({
    where: {
      workspaceId,
      createdAt: { gte: since },
    },
    select: { id: true, sessionId: true },
  });

  if (documents.length === 0) {
    return json({ deleted: 0 });
  }

  let deleted = 0;
  for (const doc of documents) {
    await deleteSession(doc.sessionId as string, userId);
    await deleteDocument(doc.id, workspaceId);
    deleted++;
  }

  return json({ deleted });
}
