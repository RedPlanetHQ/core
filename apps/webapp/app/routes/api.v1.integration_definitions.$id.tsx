import { json } from "@remix-run/node";
import { z } from "zod";
import {
  createLoaderApiRoute,
  createHybridActionApiRoute,
} from "~/services/routeBuilders/apiBuilder.server";
import { prisma } from "~/db.server";
import { logger } from "~/services/logger.service";

const ParamsSchema = z.object({
  id: z.string().uuid(),
});

// Schema for updating an integration definition
const UpdateIntegrationDefinitionBodySchema = z.object({
  name: z.string().min(1).optional(),
  slug: z
    .string()
    .min(1)
    .regex(/^[a-z0-9-]+$/)
    .optional(),
  description: z.string().min(1).optional(),
  icon: z.string().min(1).optional(),
  url: z.string().url().optional().nullable(),
  spec: z
    .object({
      name: z.string(),
      key: z.string(),
      description: z.string(),
      icon: z.string(),
      mcp: z.object({
        type: z.enum(["cli", "http"]),
        url: z.string().optional(),
        headers: z.record(z.string(), z.string()).optional(),
        needsAuth: z.boolean().optional(),
      }),
      schedule: z
        .object({
          frequency: z.string(),
        })
        .optional(),
      auth: z.record(z.string(), z.any()),
    })
    .optional(),
  _method: z.enum(["PUT", "DELETE"]).optional(),
});

/**
 * GET /api/v1/integration_definitions/:id
 * Returns a single integration definition
 */
export const loader = createLoaderApiRoute(
  {
    params: ParamsSchema,
    allowJWT: true,
    corsStrategy: "all",
    findResource: async (params) => {
      const definition = await prisma.integrationDefinitionV2.findUnique({
        where: { id: params.id },
      });
      return definition;
    },
  },
  async ({ resource: definition, authentication }) => {
    if (!definition) {
      return json(
        { error: "Integration definition not found" },
        { status: 404 },
      );
    }

    // Check workspace access
    if (
      definition.workspaceId &&
      definition.workspaceId !== authentication.workspaceId
    ) {
      return json({ error: "Access denied" }, { status: 403 });
    }

    return json({ definition });
  },
);

/**
 * POST /api/v1/integration_definitions/:id
 * Updates or deletes an integration definition
 * Use _method: "PUT" for update, _method: "DELETE" for delete
 */
const { action } = createHybridActionApiRoute(
  {
    params: ParamsSchema,
    body: UpdateIntegrationDefinitionBodySchema,
    allowJWT: true,
    authorization: {
      action: "integrationdefinition:update",
    },
    corsStrategy: "all",
  },
  async ({ params, body, authentication, request }) => {
    const { workspaceId } = authentication;
    const method = body._method || request.method;

    // Find the integration definition
    const existing = await prisma.integrationDefinitionV2.findUnique({
      where: { id: params.id, workspaceId },
    });

    if (!existing) {
      return json(
        { error: "Integration definition not found" },
        { status: 404 },
      );
    }

    // Check workspace access - only workspace-specific definitions can be modified
    if (!existing.workspaceId) {
      return json(
        { error: "Cannot modify global integration definitions" },
        { status: 403 },
      );
    }

    if (existing.workspaceId !== workspaceId) {
      return json({ error: "Access denied" }, { status: 403 });
    }

    // Handle DELETE
    if (method === "DELETE") {
      try {
        // Check if there are any connected accounts
        const accountCount = await prisma.integrationAccount.count({
          where: { integrationDefinitionId: params.id },
        });

        if (accountCount > 0) {
          return json(
            {
              error: `Cannot delete: ${accountCount} account(s) are using this integration`,
            },
            { status: 400 },
          );
        }

        await prisma.integrationDefinitionV2.delete({
          where: { id: params.id, workspaceId },
        });

        logger.info("Deleted integration definition", {
          integrationDefinitionId: params.id,
          workspaceId,
        });

        return json({ success: true, deleted: true });
      } catch (error) {
        logger.error("Error deleting integration definition", {
          error,
          integrationDefinitionId: params.id,
          workspaceId,
        });

        return json(
          { error: "Failed to delete integration definition" },
          { status: 500 },
        );
      }
    }

    // Handle UPDATE (PUT)
    try {
      const { _method, ...updateData } = body;

      // Check for name/slug conflicts if updating those fields
      if (updateData.name || updateData.slug) {
        const conflict = await prisma.integrationDefinitionV2.findFirst({
          where: {
            AND: [
              { id: { not: params.id } },
              {
                OR: [
                  updateData.name ? { name: updateData.name } : {},
                  updateData.slug ? { slug: updateData.slug, workspaceId } : {},
                ].filter((o) => Object.keys(o).length > 0),
              },
            ],
          },
        });

        if (conflict) {
          return json(
            { error: "Integration with this name or slug already exists" },
            { status: 409 },
          );
        }
      }

      const updated = await prisma.integrationDefinitionV2.update({
        where: { id: params.id },
        data: {
          ...(updateData.name && { name: updateData.name }),
          ...(updateData.slug && { slug: updateData.slug }),
          ...(updateData.description && {
            description: updateData.description,
          }),
          ...(updateData.icon && { icon: updateData.icon }),
          ...(updateData.url !== undefined && { url: updateData.url }),
          ...(updateData.spec && { spec: updateData.spec }),
        },
      });

      logger.info("Updated integration definition", {
        integrationDefinitionId: params.id,
        workspaceId,
      });

      return json({
        success: true,
        integrationDefinition: {
          id: updated.id,
          name: updated.name,
          slug: updated.slug,
          description: updated.description,
          icon: updated.icon,
        },
      });
    } catch (error) {
      logger.error("Error updating integration definition", {
        error,
        integrationDefinitionId: params.id,
        workspaceId,
      });

      return json(
        { error: "Failed to update integration definition" },
        { status: 500 },
      );
    }
  },
);

export { action };
