import { json } from "@remix-run/node";
import { z } from "zod";
import { prisma } from "~/db.server";
import {
  createHybridLoaderApiRoute,
  createActionApiRoute,
} from "~/services/routeBuilders/apiBuilder.server";
import { addReminder } from "~/services/reminder.server";
import { logger } from "~/services/logger.service";
import type { MessageChannel } from "~/services/agent/types";

// Schema for list search parameters
const RemindersSearchParams = z.object({
  limit: z.string().optional(),
  cursor: z.string().optional(),
  isActive: z.string().optional(),
  channel: z.string().optional(),
});

// Schema for creating a reminder
const ReminderCreateSchema = z.object({
  text: z.string().min(1, "Text is required"),
  schedule: z.string().min(1, "Schedule is required"),
  channel: z.enum(["whatsapp", "email", "slack"]).default("email"),
  maxOccurrences: z.number().optional().nullable(),
  endDate: z.string().optional().nullable(),
  startDate: z.string().optional().nullable(),
  metadata: z.record(z.any()).optional().nullable(),
});

async function getAvailableChannels(
  workspaceId: string
): Promise<MessageChannel[]> {
  const [workspace, slackAccount] = await Promise.all([
    prisma.workspace.findUnique({
      where: { id: workspaceId },
      include: { UserWorkspace: { include: { user: true }, take: 1 } },
    }),
    prisma.integrationAccount.findFirst({
      where: {
        workspaceId,
        integrationDefinition: { slug: "slack" },
      },
    }),
  ]);

  const user = workspace?.UserWorkspace[0]?.user;
  const channels: MessageChannel[] = ["email"];
  if (user?.phoneNumber) channels.push("whatsapp");
  if (slackAccount) channels.push("slack");
  return channels;
}

// GET - List reminders
export const loader = createHybridLoaderApiRoute(
  {
    allowJWT: true,
    searchParams: RemindersSearchParams,
    corsStrategy: "all",
    findResource: async () => 1,
  },
  async ({ authentication, searchParams }) => {
    const limit = parseInt(searchParams.limit || "25");
    const cursor = searchParams.cursor;
    const isActive = searchParams.isActive;
    const channel = searchParams.channel;

    if (!authentication.workspaceId) {
      throw new Response("Workspace not found", { status: 404 });
    }

    // Build where clause
    const whereClause: any = {
      workspaceId: authentication.workspaceId,
    };

    if (isActive !== undefined) {
      whereClause.isActive = isActive === "true";
    }

    if (channel) {
      whereClause.channel = channel;
    }

    // Cursor-based pagination
    if (cursor) {
      whereClause.createdAt = {
        lt: new Date(cursor),
      };
    }

    const [reminders, totalCount] = await Promise.all([
      prisma.reminder.findMany({
        where: whereClause,
        orderBy: {
          createdAt: "desc",
        },
        take: limit,
      }),
      prisma.reminder.count({
        where: {
          workspaceId: authentication.workspaceId,
          ...(isActive !== undefined ? { isActive: isActive === "true" } : {}),
          ...(channel ? { channel } : {}),
        },
      }),
    ]);

    const hasMore = reminders.length === limit && totalCount > limit;
    const nextCursor =
      reminders.length > 0
        ? reminders[reminders.length - 1].createdAt.toISOString()
        : null;

    return json({
      reminders,
      hasMore,
      nextCursor,
      totalCount,
    });
  },
);

// POST - Create reminder
const { action } = createActionApiRoute(
  {
    body: ReminderCreateSchema,
    allowJWT: true,
    authorization: {
      action: "create",
    },
    corsStrategy: "all",
  },
  async ({ body, authentication }) => {
    try {
      if (!authentication.workspaceId) {
        throw new Response("Workspace not found", { status: 404 });
      }

      // Validate channel is available
      const availableChannels = await getAvailableChannels(
        authentication.workspaceId
      );
      if (!availableChannels.includes(body.channel)) {
        return json(
          {
            success: false,
            message: `Channel "${body.channel}" is not available. Available channels: ${availableChannels.join(", ")}`,
          },
          { status: 400 }
        );
      }

      logger.log("Creating reminder via API", {
        body,
        workspaceId: authentication.workspaceId,
      });

      const reminder = await addReminder(authentication.workspaceId, {
        text: body.text,
        schedule: body.schedule,
        channel: body.channel,
        maxOccurrences: body.maxOccurrences ?? null,
        endDate: body.endDate ? new Date(body.endDate) : null,
        startDate: body.startDate ? new Date(body.startDate) : null,
        metadata: body.metadata ?? null,
      });

      return json({
        success: true,
        reminder,
      });
    } catch (error) {
      logger.error("Failed to create reminder via API", { error, body });
      throw error;
    }
  },
);

export { action };
