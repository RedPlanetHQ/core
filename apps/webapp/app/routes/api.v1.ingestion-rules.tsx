import { json } from "@remix-run/node";
import { z } from "zod";

import { createActionApiRoute } from "~/services/routeBuilders/apiBuilder.server";
import { prisma } from "~/db.server";
import { logger } from "~/services/logger.service";

const IngestionRuleCreateSchema = z.object({
  name: z.string().optional(),
  text: z.string().min(1, "Rule text is required"),
  source: z.string().min(1, "Source is required"),
  isActive: z.boolean().default(true),
});

const IngestionRuleUpdateSchema = z.object({
  id: z.string(),
  name: z.string().optional(),
  text: z.string().min(1, "Rule text is required").optional(),
  source: z.string().min(1, "Source is required").optional(),
  isActive: z.boolean().optional(),
});

const { action, loader } = createActionApiRoute(
  {
    body: z.union([IngestionRuleCreateSchema, IngestionRuleUpdateSchema]),
    allowJWT: true,
    authorization: {
      action: "manage",
    },
    corsStrategy: "all",
  },
  async ({ body, authentication, request }) => {
    try {
      const user = await prisma.user.findUnique({
        where: { id: authentication.userId },
        include: { Workspace: true },
      });

      if (!user?.Workspace) {
        throw new Error("User workspace not found");
      }

      if (request.method === "POST") {
        // Create new rule
        const createData = body as z.infer<typeof IngestionRuleCreateSchema>;
        
        logger.log("Creating ingestion rule", { createData, userId: authentication.userId });

        const rule = await prisma.ingestionRule.create({
          data: {
            name: createData.name,
            text: createData.text,
            source: createData.source,
            isActive: createData.isActive,
            workspaceId: user.Workspace.id,
            userId: authentication.userId,
          },
        });

        return json({
          success: true,
          rule: {
            id: rule.id,
            name: rule.name,
            text: rule.text,
            source: rule.source,
            isActive: rule.isActive,
            createdAt: rule.createdAt,
            updatedAt: rule.updatedAt,
          },
        });
      } else if (request.method === "PUT") {
        // Update existing rule
        const updateData = body as z.infer<typeof IngestionRuleUpdateSchema>;
        
        logger.log("Updating ingestion rule", { updateData, userId: authentication.userId });

        const rule = await prisma.ingestionRule.update({
          where: {
            id: updateData.id,
            workspaceId: user.Workspace.id, // Ensure user can only update their workspace rules
          },
          data: {
            ...(updateData.name !== undefined && { name: updateData.name }),
            ...(updateData.text && { text: updateData.text }),
            ...(updateData.source && { source: updateData.source }),
            ...(updateData.isActive !== undefined && { isActive: updateData.isActive }),
          },
        });

        return json({
          success: true,
          rule: {
            id: rule.id,
            name: rule.name,
            text: rule.text,
            source: rule.source,
            isActive: rule.isActive,
            createdAt: rule.createdAt,
            updatedAt: rule.updatedAt,
          },
        });
      } else if (request.method === "GET") {
        // List rules
        const url = new URL(request.url);
        const source = url.searchParams.get("source");
        const isActive = url.searchParams.get("isActive");

        const where: any = {
          workspaceId: user.Workspace.id,
          deleted: null,
        };

        if (source) {
          where.source = source;
        }

        if (isActive !== null) {
          where.isActive = isActive === "true";
        }

        const rules = await prisma.ingestionRule.findMany({
          where,
          orderBy: { createdAt: "desc" },
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

        return json({ success: true, rules });
      }

      return json({ success: false, message: "Method not supported" }, { status: 405 });
    } catch (error) {
      logger.error("Failed to manage ingestion rules", { error, body });
      throw error;
    }
  },
);

export { action, loader };