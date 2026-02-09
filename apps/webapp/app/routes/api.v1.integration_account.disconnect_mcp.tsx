import { json, type ActionFunctionArgs } from "@remix-run/node";
import { requireUser } from "~/services/session.server";

import { logger } from "~/services/logger.service";
import { prisma } from "~/db.server";
import { triggerIntegrationWebhook } from "~/trigger/webhooks/integration-webhook-delivery";

export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, { status: 405 });
  }

  try {
    const { id: userId, workspaceId } = await requireUser(request);
    const body = await request.json();
    const { integrationAccountId } = body;

    if (!integrationAccountId) {
      return json(
        { error: "Integration account ID is required" },
        { status: 400 },
      );
    }


    if (!workspaceId) {
      return json(
        { error: "Workspace is required" },
        { status: 400 },
      );
    }

    // Get the current integration account
    const currentAccount = await prisma.integrationAccount.findUnique({
      where: {
        id: integrationAccountId,
        deleted: null,
      },
    });

    if (!currentAccount) {
      return json({ error: "Integration account not found" }, { status: 404 });
    }

    // Parse the current configuration
    const currentConfig =
      (currentAccount.integrationConfiguration as any) || {};

    // Remove the mcp key from the configuration
    const updatedConfig = { ...currentConfig };
    delete updatedConfig.mcp;

    // Update the integration account
    const updatedAccount = await prisma.integrationAccount.update({
      where: {
        id: integrationAccountId,
        deleted: null,
      },
      data: {
        integrationConfiguration: updatedConfig,
      },
    });

    await triggerIntegrationWebhook(
      integrationAccountId,
      userId,
      "mcp.disconnected",
      workspaceId
    );

    logger.info("MCP configuration disconnected", {
      integrationAccountId,
      userId,
    });

    return json({
      success: true,
      message: "MCP configuration disconnected successfully",
      account: updatedAccount,
    });
  } catch (error) {
    logger.error("Failed to disconnect MCP configuration", {
      error: error instanceof Error ? error.message : "Unknown error",
    });

    return json(
      { error: "Failed to disconnect MCP configuration" },
      { status: 500 },
    );
  }
}
