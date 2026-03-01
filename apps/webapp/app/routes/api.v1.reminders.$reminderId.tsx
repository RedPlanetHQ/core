import { json } from "@remix-run/node";
import { z } from "zod";
import { prisma } from "~/db.server";
import { createActionApiRoute } from "~/services/routeBuilders/apiBuilder.server";
import {
  updateReminder,
  deleteReminder,
} from "~/services/reminder.server";
import { logger } from "~/services/logger.service";
import type { MessageChannel } from "~/services/agent/types";

const ParamsSchema = z.object({
  reminderId: z.string(),
});

const ReminderUpdateSchema = z.object({
  text: z.string().optional(),
  schedule: z.string().optional(),
  channel: z.enum(["whatsapp", "email", "slack"]).optional(),
  isActive: z.boolean().optional(),
  maxOccurrences: z.number().optional().nullable(),
  endDate: z.string().optional().nullable(),
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

const { action, loader } = createActionApiRoute(
  {
    params: ParamsSchema,
    body: ReminderUpdateSchema.optional(),
    allowJWT: true,
    authorization: {
      action: "manage",
    },
    corsStrategy: "all",
  },
  async ({ params, body, authentication, request }) => {
    try {
      if (!authentication.workspaceId) {
        throw new Response("Workspace not found", { status: 404 });
      }

      const { reminderId } = params;

      // GET - Get single reminder
      if (request.method === "GET") {
        const reminder = await prisma.reminder.findFirst({
          where: {
            id: reminderId,
            workspaceId: authentication.workspaceId,
          },
        });

        if (!reminder) {
          return json(
            { success: false, message: "Reminder not found" },
            { status: 404 },
          );
        }

        return json({ success: true, reminder });
      }

      // PUT/PATCH - Update reminder
      if (request.method === "PUT" || request.method === "PATCH") {
        if (!body) {
          return json(
            { success: false, message: "Request body is required" },
            { status: 400 },
          );
        }

        // Validate channel if provided
        if (body.channel) {
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
        }

        logger.log("Updating reminder via API", {
          reminderId,
          body,
          workspaceId: authentication.workspaceId,
        });

        const reminder = await updateReminder(
          reminderId,
          authentication.workspaceId,
          {
            text: body.text,
            schedule: body.schedule,
            channel: body.channel,
            isActive: body.isActive,
            maxOccurrences: body.maxOccurrences ?? undefined,
            endDate: body.endDate ? new Date(body.endDate) : undefined,
          },
        );

        return json({
          success: true,
          reminder,
        });
      }

      // DELETE - Delete reminder
      if (request.method === "DELETE") {
        logger.log("Deleting reminder via API", {
          reminderId,
          workspaceId: authentication.workspaceId,
        });

        await deleteReminder(reminderId, authentication.workspaceId);

        return json({
          success: true,
          message: "Reminder deleted successfully",
        });
      }

      return json(
        { success: false, message: "Method not supported" },
        { status: 405 },
      );
    } catch (error) {
      logger.error("Failed to manage reminder via API", {
        error,
        reminderId: params.reminderId,
      });
      throw error;
    }
  },
);

export { action, loader };
