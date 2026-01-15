/**
 * Integration Run Logic
 *
 * Core business logic for running integrations, shared between Trigger.dev and BullMQ implementations.
 * This module handles loading integration sources, executing CLI commands, and processing output messages.
 */

import axios from "axios";
import { spawn } from "child_process";
import {
  writeFileSync,
  unlinkSync,
  mkdtempSync,
  existsSync,
  readFileSync,
} from "fs";
import { join, isAbsolute, resolve } from "path";
import { tmpdir } from "os";
import {
  type IntegrationDefinitionV2,
  type IntegrationAccount,
} from "@core/database";
import { IntegrationEventType, type Message } from "@core/types";
import { logger } from "~/services/logger.service";

/**
 * Payload for integration run job
 */
export interface IntegrationRunPayload {
  event: IntegrationEventType;
  eventBody?: any;
  integrationDefinition: IntegrationDefinitionV2;
  integrationAccount?: IntegrationAccount;
  workspaceId?: string;
  userId?: string;
}

/**
 * Result from integration run
 */
export interface IntegrationRunResult {
  success: boolean;
  activities?: any[];
  state?: any;
  account?: any;
  unhandled?: any[];
  identifier?: any;
  error?: string;
  errors?: string[];
}

/**
 * Callbacks for integration run operations
 * These allow the business logic to trigger provider-specific actions
 */
export interface IntegrationRunCallbacks {
  // Callback for creating activities
  createActivities?: (params: {
    integrationAccountId: string;
    messages: Message[];
    userId: string;
  }) => Promise<any>;

  // Callback for saving integration account state
  saveState?: (params: {
    messages: Message[];
    integrationAccountId: string;
  }) => Promise<any>;

  // Callback for creating integration account
  createAccount?: (params: {
    integrationDefinitionId: string;
    workspaceId: string;
    settings: any;
    config: any;
    accountId: string;
    userId: string;
  }) => Promise<any>;

  // Callback for saving MCP config
  saveMCPConfig?: (params: {
    integrationAccountId: string;
    config: any;
  }) => Promise<any>;

  // Callback for triggering webhooks
  triggerWebhook?: (params: {
    integrationAccountId: string;
    userId: string;
    event: string;
    workspaceId: string;
  }) => Promise<void>;

  // Callback for extracting messages from CLI output
  extractMessages?: (output: string) => Message[];
}

/**
 * Determines if a string is a URL.
 */
function isUrl(str: string): boolean {
  try {
    // Accepts http, https, file, etc.
    const url = new URL(str);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Loads integration file from a URL or a local path.
 */
async function loadIntegrationSource(source: string): Promise<string> {
  if (!source) {
    throw new Error("Integration source is not provided");
  }

  // If it's a URL, fetch it
  if (isUrl(source)) {
    try {
      const response = await axios.get(source);
      return response.data;
    } catch (error) {
      throw new Error(
        `Failed to fetch integration file from ${source}: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  }

  // Otherwise, treat as a local file path (absolute or relative)
  let filePath = source;
  if (!isAbsolute(filePath)) {
    filePath = resolve(process.cwd(), filePath);
  }
  if (existsSync(filePath)) {
    try {
      return readFileSync(filePath, "utf8");
    } catch (error) {
      throw new Error(
        `Failed to read integration file from path ${filePath}: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  }

  throw new Error(`Integration source is not found: ${source}`);
}

/**
 * Executes integration CLI command with integration file
 */
async function executeCLICommand(
  integrationFile: string,
  eventType: IntegrationEventType,
  eventBody?: any,
  config?: any,
  integrationDefinition?: IntegrationDefinitionV2,
  state?: any,
): Promise<string> {
  return new Promise((resolve, reject) => {
    // Create temporary directory for the integration file
    const tempDir = mkdtempSync(join(tmpdir(), "integration-"));
    const integrationPath = join(tempDir, "main");

    try {
      // Write integration file to temporary location
      writeFileSync(integrationPath, integrationFile);

      // Build command arguments based on event type and integration-cli spec
      const args = [integrationPath];

      switch (eventType) {
        case IntegrationEventType.SETUP:
          args.push("setup");
          args.push("--event-body", JSON.stringify(eventBody || {}));
          args.push(
            "--integration-definition",
            JSON.stringify(integrationDefinition || {}),
          );
          break;

        case IntegrationEventType.IDENTIFY:
          args.push("identify");
          args.push("--webhook-data", JSON.stringify(eventBody || {}));
          break;

        case IntegrationEventType.PROCESS:
          args.push("process");
          args.push(
            "--event-data",
            JSON.stringify(eventBody?.eventData || eventBody || {}),
          );
          args.push("--config", JSON.stringify(config || {}));
          break;

        case IntegrationEventType.SYNC:
          args.push("sync");
          args.push("--config", JSON.stringify(config || {}));
          args.push("--state", JSON.stringify(state || {}));
          break;
        default:
          throw new Error(`Unsupported event type: ${eventType}`);
      }

      // Use node to execute the integration file
      const childProcess = spawn("node", args, {
        env: undefined,
        cwd: tempDir,
        stdio: ["pipe", "pipe", "pipe"],
      });

      let stdout = "";
      let stderr = "";

      childProcess.stdout.on("data", (data) => {
        stdout += data.toString();
        console.log(stdout);
      });

      childProcess.stderr.on("data", (data) => {
        console.log(stderr);
        stderr += data.toString();
      });

      childProcess.on("close", (code) => {
        try {
          // Clean up temporary file
          unlinkSync(integrationPath);
        } catch (cleanupError) {
          logger.warn("Failed to cleanup temporary file", {
            error: cleanupError,
          });
        }

        if (code === 0) {
          resolve(stdout);
        } else {
          reject(
            new Error(
              `Integration CLI failed with exit code ${code}: ${stderr}`,
            ),
          );
        }
      });

      childProcess.on("error", (error) => {
        try {
          unlinkSync(integrationPath);
        } catch (cleanupError) {
          logger.warn("Failed to cleanup temporary file", {
            error: cleanupError,
          });
        }
        reject(error);
      });
    } catch (error) {
      try {
        unlinkSync(integrationPath);
      } catch (cleanupError) {
        logger.warn("Failed to cleanup temporary file", {
          error: cleanupError,
        });
      }
      reject(error);
    }
  });
}

/**
 * Handles CLI messages array and performs necessary actions based on message types
 */
async function handleMessageResponse(
  messages: Message[],
  integrationDefinition: IntegrationDefinitionV2,
  workspaceId: string,
  userId: string,
  integrationAccountId: string | undefined,
  callbacks: IntegrationRunCallbacks,
): Promise<any> {
  try {
    logger.info("Handling CLI message response", {
      integrationId: integrationDefinition.id,
      messageCount: messages.length,
      messageTypes: messages.map((m) => m.type),
    });

    const responses = {
      activities: [],
      state: undefined,
      account: undefined,
      unhandled: [],
    } as any;

    // Group messages by type
    const grouped: Record<string, Message[]> = {};
    for (const message of messages) {
      if (!grouped[message.type]) {
        grouped[message.type] = [];
      }
      grouped[message.type].push(message);
    }

    // Handle "activity" messages
    if (grouped["activity"] && callbacks.createActivities) {
      const activities = await callbacks.createActivities({
        integrationAccountId: integrationAccountId as string,
        messages: grouped["activity"],
        userId,
      });

      responses.activities = activities;
    }

    // Handle "state" messages
    if (grouped["state"] && callbacks.saveState) {
      const state = await callbacks.saveState({
        messages: grouped["state"],
        integrationAccountId: integrationAccountId as string,
      });

      responses.state = state;
    }

    // Handle "identifier" messages
    if (grouped["identifier"]) {
      return {
        success: true,
        result: {
          identifiers: grouped["identifier"].map((id) => ({ id: id.data })),
        },
      };
    }

    // Handle "account" messages
    if (grouped["account"]) {
      const message = grouped["account"][0];
      const mcp = message.data.mcp;

      if (mcp && callbacks.saveMCPConfig) {
        const config = await callbacks.saveMCPConfig({
          integrationAccountId: integrationAccountId as string,
          config: message.data.config,
        });

        if (callbacks.triggerWebhook) {
          await callbacks.triggerWebhook({
            integrationAccountId: integrationAccountId as string,
            userId,
            event: "mcp.connected",
            workspaceId,
          });
        }

        responses.account = config;
      } else if (callbacks.createAccount) {
        const {
          data: { settings, config, accountId },
        } = grouped["account"][0];

        const integrationAccount = await callbacks.createAccount({
          integrationDefinitionId: integrationDefinition.id,
          workspaceId,
          settings,
          config,
          accountId,
          userId,
        });

        // Trigger OAuth integration webhook notifications
        if (callbacks.triggerWebhook) {
          try {
            await callbacks.triggerWebhook({
              integrationAccountId: integrationAccount.id,
              userId,
              event: "integration.connected",
              workspaceId,
            });
          } catch (error) {
            logger.error("Failed to trigger OAuth integration webhook", {
              integrationAccountId: integrationAccount.id,
              userId,
              error: error instanceof Error ? error.message : String(error),
            });
            // Don't fail the integration creation if webhook delivery fails
          }
        }

        responses.account = integrationAccount;
      }
    }

    // Warn for unknown message types
    for (const type of Object.keys(grouped)) {
      if (!["activity", "state", "identifier", "account"].includes(type)) {
        responses.unhandled.push(grouped[type]);
      }
    }

    return responses;
  } catch (error) {
    logger.error("Failed to handle CLI message response", {
      error: error instanceof Error ? error.message : "Unknown error",
      integrationId: integrationDefinition.id,
      messages,
    });
    throw error;
  }
}

/**
 * Core business logic for processing integration runs
 * This is shared between Trigger.dev and BullMQ implementations
 */
export async function processIntegrationRun(
  payload: IntegrationRunPayload,
  callbacks: IntegrationRunCallbacks,
): Promise<IntegrationRunResult> {
  const {
    eventBody,
    integrationAccount,
    integrationDefinition,
    event,
    workspaceId,
    userId,
  } = payload;

  try {
    logger.info(`Starting integration run for ${integrationDefinition.slug}`, {
      event,
      integrationId: integrationDefinition.id,
    });

    // Load the integration file from a URL or a local path
    const integrationSource = integrationDefinition.url as string;
    const integrationFile = await loadIntegrationSource(integrationSource);
    logger.info(`Loaded integration file from ${integrationSource}`);

    // Prepare enhanced event body based on event type
    let enhancedEventBody = eventBody;

    // For SETUP events, include OAuth response and parameters
    if (event === IntegrationEventType.SETUP) {
      enhancedEventBody = {
        ...eventBody,
      };
    }

    // For PROCESS events, ensure eventData is properly structured
    if (event === IntegrationEventType.PROCESS) {
      enhancedEventBody = {
        eventData: eventBody,
      };
    }

    logger.info(`Executing integration CLI`, {
      event,
      integrationId: integrationDefinition.id,
      hasConfig: !!integrationAccount?.integrationConfiguration,
    });

    const settings = integrationAccount?.settings as any;

    // Execute the CLI command using node
    const output = await executeCLICommand(
      integrationFile,
      event,
      enhancedEventBody,
      integrationAccount?.integrationConfiguration,
      integrationDefinition,
      settings?.state,
    );

    logger.info("Integration CLI executed successfully");

    // Process the output messages
    const messages = callbacks.extractMessages
      ? callbacks.extractMessages(output)
      : [];

    logger.info("Integration run completed", {
      messageCount: messages.length,
      messageTypes: messages.map((m) => m.type),
    });

    // Handle all CLI messages through the generic handler
    const result = await handleMessageResponse(
      messages,
      integrationDefinition,
      workspaceId as string,
      userId as string,
      integrationAccount?.id,
      callbacks,
    );

    return {
      success: true,
      ...result,
    };
  } catch (error) {
    const errorMessage = `Integration run failed: ${error instanceof Error ? error.message : "Unknown error"}`;
    logger.error(errorMessage, {
      integrationId: integrationDefinition.id,
      event,
      error,
    });

    // For SETUP commands, we need to throw the error so OAuth callback can handle it
    if (event === IntegrationEventType.SETUP) {
      throw error;
    }

    // For other commands, return error in appropriate format
    return {
      success: false,
      error: errorMessage,
      errors: [errorMessage],
    };
  }
}
