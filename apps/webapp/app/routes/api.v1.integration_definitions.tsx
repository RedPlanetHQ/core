import { json } from "@remix-run/node";
import { z } from "zod";
import {
  createHybridLoaderApiRoute,
  createHybridActionApiRoute,
} from "~/services/routeBuilders/apiBuilder.server";
import { prisma } from "~/db.server";
import { getIntegrationDefinitions } from "~/services/integrationDefinition.server";
import { logger } from "~/services/logger.service";

// Schema for creating an integration definition
const IntegrationDefinitionBodySchema = z.object({
  name: z.string().min(1, "Name is required"),
  slug: z
    .string()
    .min(1, "Slug is required")
    .regex(/^[a-z0-9-]+$/, "Slug must be lowercase alphanumeric with hyphens"),
  description: z.string().min(1, "Description is required"),
  icon: z.string().min(1, "Icon is required"),
  url: z.string().url(),
  spec: z.object({
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
  }),
});

/**
 * GET /api/v1/integration_definitions
 * Returns all integration definitions available to the workspace
 */
const loader = createHybridLoaderApiRoute(
  {
    allowJWT: true,
    corsStrategy: "all",
    findResource: async () => 1,
  },
  async ({ authentication }) => {
    if (!authentication.workspaceId) {
      throw new Error("Workspace not found");
    }

    const definitions = await getIntegrationDefinitions(
      authentication.workspaceId,
    );

    return json({ definitions });
  },
);

/**
 * POST /api/v1/integration_definitions
 * Creates a new integration definition for the workspace
 */
const { action } = createHybridActionApiRoute(
  {
    body: IntegrationDefinitionBodySchema,
    allowJWT: true,
    authorization: {
      action: "integrationdefinition:create",
    },
    corsStrategy: "all",
  },
  async ({ body, authentication }) => {
    const { name, slug, description, icon, url, spec } = body;
    const { workspaceId } = authentication;

    if (!workspaceId) {
      return json({ error: "Workspace not found" }, { status: 400 });
    }

    try {
      // Check if integration with this name or slug already exists
      const existing = await prisma.integrationDefinitionV2.findFirst({
        where: {
          OR: [{ name }, { slug, workspaceId }],
        },
      });

      if (existing) {
        return json(
          { error: "Integration with this name or slug already exists" },
          { status: 409 },
        );
      }

      // Create the integration definition
      const integrationDefinition = await prisma.integrationDefinitionV2.create(
        {
          data: {
            name,
            slug,
            description,
            icon,
            url,
            spec,
            version: "1.0.0",
            workspaceId,
          },
        },
      );

      logger.info("Created integration definition", {
        integrationDefinitionId: integrationDefinition.id,
        name,
        slug,
        workspaceId,
      });

      return json({
        success: true,
        integrationDefinition: {
          id: integrationDefinition.id,
          name: integrationDefinition.name,
          slug: integrationDefinition.slug,
          description: integrationDefinition.description,
          icon: integrationDefinition.icon,
        },
      });
    } catch (error) {
      logger.error("Error creating integration definition", {
        error,
        name,
        slug,
        workspaceId,
      });

      return json(
        { error: "Failed to create integration definition" },
        { status: 500 },
      );
    }
  },
);

export { loader, action };
