import { json } from "@remix-run/node";
import { z } from "zod";
import {
  createHybridLoaderApiRoute,
  createHybridActionApiRoute,
} from "~/services/routeBuilders/apiBuilder.server";
import { IntegrationRunner } from "~/services/integrations/integration-runner";
import { getIntegrationDefinitionWithId } from "~/services/integrationDefinition.server";
import { logger } from "~/services/logger.service";
import { prisma } from "~/db.server";

import { getConnectedIntegrationAccounts } from "~/services/integrationAccount.server";

// Schema for creating an integration account.
// `apiKey` is optional so the same endpoint can install widget-only
// (no-auth) integrations — when the spec declares no auth and has widgets
// we create a stub IntegrationAccount instead of running SETUP.
const IntegrationAccountBodySchema = z.object({
  integrationDefinitionId: z.string(),
  apiKey: z.string().optional(),
  // Additional fields from multi-field API key auth (e.g., ghost_url)
  fields: z.record(z.string(), z.string()).optional(),
});

/**
 * GET /api/v1/integration_account
 * Returns all connected integration accounts for the user's workspace
 */
const loader = createHybridLoaderApiRoute(
  {
    allowJWT: true,
    corsStrategy: "all",
    findResource: async () => 1,
  },
  async ({ authentication }) => {
    if (!authentication.workspaceId) {
      throw new Error("User workspace not found");
    }

    const accounts = await getConnectedIntegrationAccounts(
      authentication.userId,
      authentication?.workspaceId as string,
    );

    return json({ accounts });
  },
);

/**
 * POST /api/v1/integration_account
 * Creates an integration account with an API key
 */
const { action } = createHybridActionApiRoute(
  {
    body: IntegrationAccountBodySchema,
    allowJWT: true,
    authorization: {
      action: "integrationaccount:create",
    },
    corsStrategy: "all",
  },
  async ({ body, authentication }) => {
    const { integrationDefinitionId, apiKey, fields } = body;
    const { userId } = authentication;

    try {
      // Get the integration definition
      const integrationDefinition = await getIntegrationDefinitionWithId(
        integrationDefinitionId,
      );

      if (!integrationDefinition) {
        return json(
          { error: "Integration definition not found" },
          { status: 404 },
        );
      }

      const spec = (integrationDefinition.spec as any) ?? {};
      const hasAnyAuth = !!(
        spec?.auth?.OAuth2 ||
        spec?.auth?.api_key ||
        spec?.auth?.mcp
      );
      const hasWidgets =
        Array.isArray(spec?.widgets) && spec.widgets.length > 0;
      const hasFields = fields && Object.keys(fields).length > 0;
      const hasApiKey = typeof apiKey === "string" && apiKey.length > 0;

      // Widget-only install path: no auth declared on the integration and
      // no credentials supplied. Create a stub IntegrationAccount so the
      // widget loader picks it up. The composite unique key
      // (accountId, integrationDefinitionId, workspaceId) keeps re-installs
      // idempotent.
      if (!hasAnyAuth && !hasApiKey && !hasFields) {
        if (!hasWidgets) {
          return json(
            { error: "Integration has no auth method or widgets to install" },
            { status: 400 },
          );
        }

        const accountId = `${integrationDefinition.slug}-widget`;
        const workspaceId = authentication.workspaceId as string;

        const existing = await prisma.integrationAccount.findFirst({
          where: {
            accountId,
            integrationDefinitionId: integrationDefinition.id,
            workspaceId,
          },
        });

        const account = existing
          ? await prisma.integrationAccount.update({
              where: { id: existing.id },
              data: { isActive: true, integratedById: userId },
            })
          : await prisma.integrationAccount.create({
              data: {
                integrationDefinitionId: integrationDefinition.id,
                workspaceId,
                integratedById: userId,
                accountId,
                integrationConfiguration: {},
                settings: {},
                isActive: true,
              },
            });

        logger.info("Widget-only integration installed", {
          integrationAccountId: account.id,
          integrationDefinitionId: integrationDefinition.id,
          slug: integrationDefinition.slug,
          userId,
          workspaceId,
        });

        return json({ success: true, setupResult: { account } });
      }

      // Auth-based install path (API key, possibly multi-field)
      if (!hasApiKey && !hasFields) {
        return json(
          { error: "API key or required fields are missing" },
          { status: 400 },
        );
      }

      // Build eventBody: if fields are provided, spread them for multi-field auth
      // For multi-field auth (e.g., Ghost), all values come from fields
      const eventBody = hasFields
        ? { apiKey: "", ...fields }
        : { apiKey: apiKey as string };

      // Trigger the SETUP event for the integration
      const messages = await IntegrationRunner.setup({
        eventBody,
        integrationDefinition,
      });

      const setupResult = await IntegrationRunner.handleSetupMessages(
        messages,
        integrationDefinition,
        authentication.workspaceId as string,
        userId,
      );

      if (!setupResult.account || !setupResult.account.id) {
        return json(
          { error: "Failed to setup integration with the provided API key" },
          { status: 400 },
        );
      }

      return json({ success: true, setupResult });
    } catch (error) {
      logger.error("Error creating integration account", {
        error,
        userId,
        integrationDefinitionId,
      });
      return json(
        { error: "Failed to create integration account" },
        { status: 500 },
      );
    }
  },
);

export { loader, action };
