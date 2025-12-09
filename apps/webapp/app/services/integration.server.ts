import { runs, tasks } from "@trigger.dev/sdk/v3";

import { logger } from "./logger.service";
import { type integrationRun } from "~/trigger/integrations/integration-run";
import {
  enqueueIntegrationRun,
  isTriggerDeployment,
} from "~/lib/queue-adapter.server";
import type { IntegrationRunPayload } from "~/jobs/integrations/integration-run.logic";

import type {
  IntegrationAccount,
  IntegrationDefinitionV2,
} from "@core/database";

/**
 * Triggers an integration run asynchronously.
 */
export async function runIntegrationTriggerAsync(
  integrationDefinition: IntegrationDefinitionV2,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  event: any,
  userId?: string,
  workspaceId?: string,
) {
  logger.info(
    `Triggering async integration run for ${integrationDefinition.slug}`,
    {
      integrationId: integrationDefinition.id,
      event: event.event,
      userId,
      workspaceId,
    },
  );

  const payload: IntegrationRunPayload = {
    integrationDefinition,
    event: event.event,
    eventBody: event.eventBody,
    integrationAccount: event.integrationAccount,
    workspaceId,
    userId,
  };

  return await enqueueIntegrationRun(payload);
}

/**
 * Triggers an integration run and waits for completion.
 * Supports both Trigger.dev and BullMQ by polling job status until completion.
 */
export async function runIntegrationTrigger(
  integrationDefinition: IntegrationDefinitionV2,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  event: any,
  userId?: string,
  workspaceId?: string,
  integrationAccount?: IntegrationAccount,
) {
  logger.info(
    `Triggering sync integration run for ${integrationDefinition.slug}`,
    {
      integrationId: integrationDefinition.id,
      event: event.event,
      userId,
      workspaceId,
    },
  );

  const payload: IntegrationRunPayload = {
    integrationDefinition,
    integrationAccount,
    workspaceId,
    userId,
    event: event.event,
    eventBody: event.eventBody,
  };

  const response = await enqueueIntegrationRun(payload);

  if (!response.id) {
    return {
      error: true,
      message: "Failed to enqueue integration run - no job ID returned",
    };
  }

  // Wait for completion based on provider
  if (isTriggerDeployment()) {
    // Trigger.dev: Use runs API to poll status
    let run = await runs.retrieve(response.id);
    const maxAttempts = 150; // 5 minutes with 2s intervals
    let attempts = 0;

    while (run.status !== "COMPLETED" && run.status !== "FAILED") {
      attempts++;

      if (attempts >= maxAttempts) {
        logger.error(
          `Integration run timed out after ${maxAttempts} attempts`,
          {
            runId: response.id,
            status: run.status,
            integrationSlug: integrationDefinition.slug,
          },
        );

        return {
          error: true,
          message: `Integration run timed out after ${maxAttempts * 2} seconds`,
        };
      }

      await new Promise((resolve) => setTimeout(resolve, 2000)); // Wait 2s
      run = await runs.retrieve(response.id);
      logger.info(
        `Task status: ${run.status} (attempt ${attempts}/${maxAttempts})`,
      );
    }

    if (run.status === "FAILED") {
      logger.error(`Integration run failed`, {
        runId: response.id,
        integrationSlug: integrationDefinition.slug,
      });

      return {
        error: true,
        message: `Integration failed`,
      };
    }

    return run.output;
  } else {
    // BullMQ: Poll job status until completion
    const { integrationRunQueue } = await import("~/bullmq/queues");
    const maxAttempts = 150; // 5 minutes with 2s intervals
    let attempts = 0;

    while (attempts < maxAttempts) {
      const job = await integrationRunQueue.getJob(response.id);

      if (!job) {
        logger.error("Integration job not found", {
          jobId: response.id,
          integrationSlug: integrationDefinition.slug,
        });
        return {
          error: true,
          message: `Integration job not found: ${response.id}`,
        };
      }

      const state = await job.getState();
      logger.info(
        `Job status: ${state} (attempt ${attempts + 1}/${maxAttempts})`,
      );

      if (state === "completed") {
        return job.returnvalue;
      }

      if (state === "failed") {
        logger.error("Integration run failed", {
          jobId: response.id,
          integrationSlug: integrationDefinition.slug,
          failedReason: job.failedReason,
        });

        return {
          error: true,
          message: job.failedReason,
        };
      }

      attempts++;

      if (attempts >= maxAttempts) {
        logger.error(
          `Integration run timed out after ${maxAttempts} attempts`,
          {
            jobId: response.id,
            state,
            integrationSlug: integrationDefinition.slug,
          },
        );

        return {
          error: true,
          message: `Integration run timed out after ${maxAttempts * 2} seconds`,
        };
      }

      await new Promise((resolve) => setTimeout(resolve, 2000)); // Wait 2s
    }

    return {
      error: true,
      message: "Integration run exceeded maximum wait time",
    };
  }
}
