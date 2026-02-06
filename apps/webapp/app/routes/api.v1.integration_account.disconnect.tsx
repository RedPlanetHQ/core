import { json, type ActionFunctionArgs } from "@remix-run/node";
import { requireUserId } from "~/services/session.server";

import { logger } from "~/services/logger.service";
import { prisma } from "~/db.server";
import { triggerIntegrationWebhook } from "~/trigger/webhooks/integration-webhook-delivery";
import { schedules } from "@trigger.dev/sdk";

export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, { status: 405 });
  }

  try {
    const userId = await requireUserId(request);
    const body = await request.json();
    const { integrationAccountId } = body;

    if (!integrationAccountId) {
      return json(
        { error: "Integration account ID is required" },
        { status: 400 },
      );
    }

    const updatedAccount = await prisma.integrationAccount.delete({
      where: {
        id: integrationAccountId,
      },
    });

    const integrationAccountSettings = updatedAccount.settings as any;

    await schedules.del(integrationAccountSettings.scheduleId);

    await triggerIntegrationWebhook(
      integrationAccountId,
      userId,
      "integration.disconnected",
      updatedAccount.workspaceId,
    );

    logger.info("Integration account disconnected (soft deleted)", {
      integrationAccountId,
      userId,
    });

    return json({
      success: true,
      message: "Integration account disconnected successfully",
    });
  } catch (error) {
    logger.error("Failed to disconnect integration account", {
      error: error instanceof Error ? error.message : "Unknown error",
    });

    return json(
      { error: "Failed to disconnect integration account" },
      { status: 500 },
    );
  }
}
