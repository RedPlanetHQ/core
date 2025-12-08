import { logger, task } from "@trigger.dev/sdk/v3";
import {
  type IntegrationDefinitionV2,
  type IntegrationAccount,
} from "@core/database";
import { IntegrationEventType } from "@core/types";
import {
  type IntegrationRunPayload,
  processIntegrationRun,
} from "~/jobs/integrations/integration-run.logic";
import { extractMessagesFromOutput } from "../utils/cli-message-handler";
import {
  createActivities,
  createIntegrationAccount,
  saveIntegrationAccountState,
  saveMCPConfig,
} from "../utils/message-utils";
import { triggerIntegrationWebhook } from "../webhooks/integration-webhook-delivery";

// All core business logic has been moved to ~/jobs/integrations/integration-run.logic.ts
// This Trigger.dev task now just calls the common logic with Trigger-specific callbacks

export const integrationRun = task({
  id: "integration-run",
  machine: "medium-2x",
  run: async (payload: IntegrationRunPayload) => {
    // Use common logic with Trigger-specific callbacks
    return await processIntegrationRun(payload, {
      createActivities,
      saveState: saveIntegrationAccountState,
      createAccount: createIntegrationAccount,
      saveMCPConfig,
      triggerWebhook: triggerIntegrationWebhook,
      extractMessages: extractMessagesFromOutput,
      log: (level, message, data) => {
        if (level === "error") {
          logger.error(message, data);
        } else if (level === "warn") {
          logger.warn(message, data);
        } else {
          logger.info(message, data);
        }
      },
    });
  },
});
