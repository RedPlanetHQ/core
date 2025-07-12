import { json } from "@remix-run/node";
import { z } from "zod";

import { createActionApiRoute } from "~/services/routeBuilders/apiBuilder.server";
import { prisma } from "~/db.server";
import { logger } from "~/services/logger.service";

const ParamsSchema = z.object({
  id: z.string(),
});

const { action, loader } = createActionApiRoute(
  {
    params: ParamsSchema,
    allowJWT: true,
    authorization: {
      action: "manage",
    },
    corsStrategy: "all",
  },
  async ({ params, authentication, request }) => {
    try {
      const user = await prisma.user.findUnique({
        where: { id: authentication.userId },
        include: { Workspace: true },
      });

      if (!user?.Workspace) {
        throw new Error("User workspace not found");
      }

      if (request.method === "DELETE") {
        logger.log("Deleting ingestion rule", { ruleId: params.id, userId: authentication.userId });

        // Soft delete by setting deleted timestamp
        const rule = await prisma.ingestionRule.update({
          where: {
            id: params.id,
            workspaceId: user.Workspace.id, // Ensure user can only delete their workspace rules
          },
          data: {
            deleted: new Date(),
          },
        });

        return json({
          success: true,
          message: "Rule deleted successfully",
          ruleId: rule.id,
        });
      } else if (request.method === "GET") {
        // Get single rule
        const rule = await prisma.ingestionRule.findFirst({
          where: {
            id: params.id,
            workspaceId: user.Workspace.id,
            deleted: null,
          },
          select: {
            id: true,
            name: true,
            text: true,
            source: true,
            isActive: true,
            createdAt: true,
            updatedAt: true,
          },
        });

        if (!rule) {
          return json({ success: false, message: "Rule not found" }, { status: 404 });
        }

        return json({ success: true, rule });
      }

      return json({ success: false, message: "Method not supported" }, { status: 405 });
    } catch (error) {
      logger.error("Failed to manage ingestion rule", { error, ruleId: params.id });
      throw error;
    }
  },
);

export { action, loader };