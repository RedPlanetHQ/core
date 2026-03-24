import { json } from "@remix-run/node";
import { z } from "zod";
import { createActionApiRoute } from "~/services/routeBuilders/apiBuilder.server";
import {
  getChannelById,
  updateChannel,
  deleteChannel,
} from "~/services/channel.server";
import { logger } from "~/services/logger.service";

const ParamsSchema = z.object({
  channelId: z.string(),
});

const ChannelUpdateSchema = z.object({
  name: z.string().optional(),
  config: z.record(z.string()).optional(),
  isDefault: z.boolean().optional(),
  isActive: z.boolean().optional(),
});

const { action, loader } = createActionApiRoute(
  {
    params: ParamsSchema,
    body: ChannelUpdateSchema.optional(),
    allowJWT: true,
    authorization: { action: "manage" },
    corsStrategy: "all",
  },
  async ({ params, body, authentication, request }) => {
    try {
      if (!authentication.workspaceId) {
        throw new Response("Workspace not found", { status: 404 });
      }

      const workspaceId = authentication.workspaceId;
      const { channelId } = params;

      const existing = await getChannelById(channelId, workspaceId);
      if (!existing) {
        return json(
          { success: false, message: "Channel not found" },
          { status: 404 },
        );
      }

      // GET
      if (request.method === "GET") {
        return json({ success: true, channel: existing });
      }

      // PATCH / PUT - Update
      if (request.method === "PATCH" || request.method === "PUT") {
        if (!body) {
          return json({ success: false, message: "Request body is required" }, { status: 400 });
        }

        await updateChannel(channelId, workspaceId, body);

        logger.log("Channel updated via API", { channelId, workspaceId });
        return json({ success: true });
      }

      // DELETE
      if (request.method === "DELETE") {
        await deleteChannel(channelId, workspaceId);
        logger.log("Channel deleted via API", { channelId, workspaceId });
        return json({ success: true, message: "Channel deactivated" });
      }

      return json({ success: false, message: "Method not supported" }, { status: 405 });
    } catch (error) {
      logger.error("Failed to manage channel", {
        error,
        channelId: params.channelId,
      });
      throw error;
    }
  },
);

export { action, loader };
