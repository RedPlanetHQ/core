import { type LoaderFunctionArgs, json } from "@remix-run/node";
import { prisma } from "~/db.server";
import { requireUser, requireUserId } from "~/services/session.server";

// Stale thresholds
const PROCESSING_STALE_THRESHOLD_MS = 60 * 60 * 1000; // 1 hour for PROCESSING items
const PENDING_STALE_THRESHOLD_MS = 24 * 60 * 60 * 1000; // 24 hours for PENDING items

export async function loader({ request }: LoaderFunctionArgs) {
  const { workspaceId} = await requireUser(request);

  if (!workspaceId) {
    throw new Response("Workspace not found", { status: 404 });
  }

  const activeIngestionQueue = await prisma.ingestionQueue.findMany({
    where: {
      workspaceId,
      status: {
        in: ["PENDING", "PROCESSING"],
      },
    },
    select: {
      id: true,
      status: true,
      createdAt: true,
      updatedAt: true,
      error: true,
      data: true,
    },
    orderBy: {
      createdAt: "desc",
    },
  });

  // Check for stale items based on status
  const now = new Date();
  const staleProcessingItems: string[] = [];
  const stalePendingItems: string[] = [];

  activeIngestionQueue.forEach((item) => {
    const itemTime = item.updatedAt || item.createdAt;
    const timeDiff = now.getTime() - itemTime.getTime();

    if (item.status === "PROCESSING" && timeDiff > PROCESSING_STALE_THRESHOLD_MS) {
      staleProcessingItems.push(item.id);
    } else if (item.status === "PENDING" && timeDiff > PENDING_STALE_THRESHOLD_MS) {
      stalePendingItems.push(item.id);
    }
  });

  // Mark stale PROCESSING items as failed
  if (staleProcessingItems.length > 0) {
    await prisma.ingestionQueue.updateMany({
      where: {
        id: {
          in: staleProcessingItems,
        },
      },
      data: {
        status: "FAILED",
        error: "Processing stale - exceeded 1 hour processing threshold",
        updatedAt: now,
      },
    });
  }

  // Mark stale PENDING items as failed
  if (stalePendingItems.length > 0) {
    await prisma.ingestionQueue.updateMany({
      where: {
        id: {
          in: stalePendingItems,
        },
      },
      data: {
        status: "FAILED",
        error: "Queue stale - exceeded 24 hour pending threshold",
        updatedAt: now,
      },
    });
  }

  // Fetch updated queue after marking stale items
  const updatedQueue = await prisma.ingestionQueue.findMany({
    where: {
      workspaceId,
      status: {
        in: ["PENDING", "PROCESSING"],
      },
    },
    select: {
      id: true,
      status: true,
      createdAt: true,
      error: true,
      data: true,
    },
    orderBy: {
      createdAt: "desc",
    },
  });

  return json({
    queue: updatedQueue,
    count: updatedQueue.length,
    markedAsStale: {
      processing: staleProcessingItems.length,
      pending: stalePendingItems.length,
      total: staleProcessingItems.length + stalePendingItems.length,
    },
  });
}
