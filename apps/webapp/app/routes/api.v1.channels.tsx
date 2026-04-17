import { json } from "@remix-run/node";
import { z } from "zod";
import {
  createHybridLoaderApiRoute,
  createActionApiRoute,
} from "~/services/routeBuilders/apiBuilder.server";
import { createChannel, getChannels } from "~/services/channel.server";
import { logger } from "~/services/logger.service";

const ChannelCreateSchema = z.object({
  name: z.string().min(1, "Name is required"),
  type: z.enum(["slack", "telegram", "whatsapp", "email"]),
  config: z.record(z.string(), z.string()),
  isDefault: z.boolean().optional().default(false),
});

// GET - List channels for workspace
export const loader = createHybridLoaderApiRoute(
  {
    allowJWT: true,
    corsStrategy: "all",
    findResource: async () => 1,
  },
  async ({ authentication }) => {
    if (!authentication.workspaceId) {
      throw new Response("Workspace not found", { status: 404 });
    }

    const channels = await getChannels(authentication.workspaceId);
    return json({ channels });
  },
);

// POST - Create channel
const { action } = createActionApiRoute(
  {
    body: ChannelCreateSchema,
    allowJWT: true,
    authorization: { action: "create" },
    corsStrategy: "all",
  },
  async ({ body, authentication }) => {
    try {
      if (!authentication.workspaceId) {
        throw new Response("Workspace not found", { status: 404 });
      }

      const { id } = await createChannel(authentication.workspaceId, {
        name: body.name,
        type: body.type,
        config: body.config,
        isDefault: body.isDefault,
      });

      logger.log("Channel created via API", { channelId: id, type: body.type });
      return json({ success: true, channelId: id });
    } catch (error) {
      logger.error("Failed to create channel", { error });
      throw error;
    }
  },
);

export { action };
