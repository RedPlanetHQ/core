/**
 * Activity CASE Logic
 *
 * Processes new activities from integrations through the CASE pipeline.
 * Each integration account gets its own persistent conversation (asyncJobId = integrationAccountId).
 */

import { env } from "~/env.server";
import { buildDecisionContext } from "~/services/agent/context/decision-context";
import {
  runCASEPipeline,
  type CASEPipelineResult,
} from "~/services/agent/decision-agent-pipeline";
import { getWorkspacePersona } from "~/models/workspace.server";
import { getOrCreatePersonalAccessToken } from "~/services/personalAccessToken.server";
import { HttpOrchestratorTools } from "~/services/agent/orchestrator-tools.http";
import { CoreClient } from "@redplanethq/sdk";
import { prisma } from "~/db.server";
import { logger } from "~/services/logger.service";
import type { WebhookTrigger } from "~/services/agent/types/decision-agent";
import type { MessageChannel } from "~/services/agent/types";

export interface ActivityCasePayload {
  integrationAccountId: string;
  workspaceId: string;
  userId: string;
  userEmail: string;
  integrationSlug: string;
  activitiesText: string;
  timezone: string;
}

export async function processActivityCase(
  payload: ActivityCasePayload,
): Promise<{ success: boolean; error?: string }> {
  const {
    integrationAccountId,
    workspaceId,
    userId,
    userEmail,
    integrationSlug,
    activitiesText,
    timezone,
  } = payload;

  try {
    // Fetch user's default channel preference instead of hardcoding "email"
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { metadata: true },
    });
    const metadata = user?.metadata as Record<string, unknown> | null;
    const defaultChannel: MessageChannel =
      (metadata?.defaultChannel as MessageChannel | undefined) ?? "email";

    const trigger: WebhookTrigger = {
      type: "integration_webhook",
      timestamp: new Date(),
      userId,
      workspaceId,
      channel: defaultChannel,
      data: {
        integration: integrationSlug,
        eventType: "activity_sync",
        payload: {},
      },
    };

    const [context, userPersona] = await Promise.all([
      buildDecisionContext(trigger, timezone ?? "UTC"),
      getWorkspacePersona(workspaceId),
    ]);

    const { token } = await getOrCreatePersonalAccessToken({
      name: "case-internal",
      userId,
      workspaceId,
      returnDecrypted: true,
    });

    const client = new CoreClient({ baseUrl: env.APP_ORIGIN, token: token! });
    const executorTools = new HttpOrchestratorTools(client);

    const result: CASEPipelineResult = await runCASEPipeline({
      trigger,
      context,
      userPersona: userPersona?.content,
      userData: { userId, email: userEmail, workspaceId },
      reminderText: activitiesText,
      reminderId: integrationAccountId,
      timezone: timezone ?? "UTC",
      executorTools,
    });

    if (!result.success) {
      logger.error(`[activity-case] Pipeline failed for ${integrationAccountId}`, {
        error: result.error,
      });
    }

    return { success: result.success, error: result.error };
  } catch (error) {
    logger.error(`[activity-case] Failed for ${integrationAccountId}`, { error });
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}
