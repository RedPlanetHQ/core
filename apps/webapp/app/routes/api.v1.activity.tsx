import { json } from "@remix-run/node";
import { z } from "zod";

import { createActionApiRoute } from "~/services/routeBuilders/apiBuilder.server";
import { addToQueue } from "~/lib/ingest.server";
import { prisma } from "~/db.server";
import { logger } from "~/services/logger.service";
import { triggerWebhookDelivery } from "~/trigger/webhooks/webhook-delivery";
import { EpisodeTypeEnum } from "@core/types";

const ActivityCreateSchema = z.object({
  text: z.string().min(1, "Text is required"),
  source: z.string().min(1, "Source is required"),
  sourceURL: z.string().url().optional(),
  integrationAccountId: z.string().optional(),
  taskId: z.string().optional(),
});

const { action, loader } = createActionApiRoute(
  {
    body: ActivityCreateSchema,
    allowJWT: true,
    authorization: {
      action: "create",
    },
    corsStrategy: "all",
  },
  async ({ body, authentication }) => {
    try {
      logger.log("Creating activity", { body, userId: authentication.userId });

      const user = await prisma.user.findUnique({
        where: {
          id: authentication.userId,
        },
        include: {
          Workspace: true,
        },
      });

      if (!user) {
        throw new Error("User not found");
      }

      // Validate workspace exists
      if (!user.Workspace?.id) {
        return json(
          {
            success: false,
            error: "WORKSPACE_REQUIRED",
            message: "Workspace not found for user. Please create a workspace before creating activities.",
            userId: user.id,
          },
          { status: 400 }
        );
      }

      // Create the activity record
      const activity = await prisma.activity.create({
        data: {
          text: body.text,
          sourceURL: body.sourceURL,
          integrationAccountId: body.integrationAccountId,
          workspaceId: user.Workspace.id,
        },
      });

      // Add activity to knowledge graph ingestion queue
      const ingestData = {
        episodeBody: body.text,
        referenceTime: new Date().toISOString(),
        source: body.source,
        type: EpisodeTypeEnum.CONVERSATION,
      };

      const queueResponse = await addToQueue(
        ingestData,
        authentication.userId,
        activity.id,
      );

      logger.log("Activity created and queued for ingestion", {
        activityId: activity.id,
        queueId: queueResponse.id,
      });

      // Trigger webhook delivery for the new activity
      if (user.Workspace?.id) {
        try {
          await triggerWebhookDelivery(activity.id, user.Workspace.id);
          logger.log("Webhook delivery triggered for activity", { activityId: activity.id });
        } catch (webhookError) {
          logger.error("Failed to trigger webhook delivery", { 
            activityId: activity.id, 
            error: webhookError 
          });
          // Don't fail the entire request if webhook delivery fails
        }
      }

      return json({
        success: true,
        activity: {
          id: activity.id,
          text: activity.text,
          sourceURL: activity.sourceURL,
          createdAt: activity.createdAt,
        },
        ingestion: {
          queueId: queueResponse.id,
        },
      });
    } catch (error) {
      logger.error("Failed to create activity", { error, body });
      throw error;
    }
  },
);

export { action, loader };
