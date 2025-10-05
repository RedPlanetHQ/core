import { logger, task } from "@trigger.dev/sdk/v3";
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
import { extractMessagesFromOutput } from "../utils/cli-message-handler";
import {
  createActivities,
  createIntegrationAccount,
  saveIntegrationAccountState,
  saveMCPConfig,
} from "../utils/message-utils";
import { triggerIntegrationWebhook } from "../webhooks/integration-webhook-delivery";
import { ingestCodeTask } from "../ingest/ingest-code";
import { prisma } from "../utils/prisma";

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
const loadIntegrationSource = async (source: string): Promise<string> => {
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
};

/**
 * Executes integration CLI command with integration file
 */
const executeCLICommand = async (
  integrationFile: string,
  eventType: IntegrationEventType,
  eventBody?: any,
  config?: any,
  integrationDefinition?: IntegrationDefinitionV2,
  state?: any,
): Promise<string> => {
  return new Promise((resolve, reject) => {
    // Create temporary directory for the integration file
    const tempDir = mkdtempSync(join(tmpdir(), "integration-"));
    const integrationPath = join(tempDir, "integration.js");

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
      });

      childProcess.stderr.on("data", (data) => {
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
};

async function handleActivityMessage(
  messages: Message[],
  integrationAccountId: string,
  userId: string,
): Promise<any> {
  return createActivities({ integrationAccountId, messages, userId });
}

async function handleStateMessage(
  messages: Message[],
  integrationAccountId: string,
): Promise<any> {
  // TODO: Implement state message handling
  return saveIntegrationAccountState({ messages, integrationAccountId });
}

async function handleIdentifierMessage(message: Message): Promise<any> {
  return message.data;
}

async function handleAccountMessage(
  messages: Message[],
  integrationDefinition: IntegrationDefinitionV2,
  workspaceId: string,
  userId: string,
  integrationAccountId: string,
): Promise<any> {
  const message = messages[0];
  const mcp = message.data.mcp;

  if (mcp) {
    const config = await saveMCPConfig({
      integrationAccountId,
      config: message.data.config,
    });
    await triggerIntegrationWebhook(
      integrationAccountId,
      userId,
      "mcp.connected",
      workspaceId,
    );
    return config;
  }

  // Handle only one messages since account gets created only for one
  const {
    data: { settings, config, accountId },
  } = messages[0];
  const integrationAccount = await createIntegrationAccount({
    integrationDefinitionId: integrationDefinition.id,
    workspaceId,
    settings,
    config,
    accountId,
    userId,
  });

  // Trigger OAuth integration webhook notifications
  try {
    await triggerIntegrationWebhook(
      integrationAccount.id,
      userId,
      "integration.connected",
      workspaceId,
    );
  } catch (error) {
    logger.error("Failed to trigger OAuth integration webhook", {
      integrationAccountId: integrationAccount.id,
      userId,
      error: error instanceof Error ? error.message : String(error),
    });
    // Don't fail the integration creation if webhook delivery fails
  }

  return integrationAccount;
}

async function handleCodeParseJobMessage(
  messages: Message[],
  integrationAccountId: string,
  userId: string,
  workspaceId: string,
): Promise<any> {
  const results = [];

  for (const message of messages) {
    const { data } = message;

    // Get GitHub token from integration account
    const integrationAccount = await prisma.integrationAccount.findUnique({
      where: { id: integrationAccountId },
    });

    if (!integrationAccount) {
      logger.error("Integration account not found", { integrationAccountId });
      continue;
    }

    const config = integrationAccount.integrationConfiguration as any;
    const github_token = config?.access_token;

    if (!github_token) {
      logger.error("GitHub token not found in integration config", {
        integrationAccountId,
      });
      continue;
    }

    // Trigger code ingestion job
    const jobPayload = {
      body: {
        ...data,
        github_token,
      },
      userId,
      workspaceId,
      integrationId: integrationAccountId,
    };

    try {
      const result = await ingestCodeTask.trigger(jobPayload);
      results.push(result);
      logger.info("Code parse job triggered", {
        repository: data.repository,
        filesCount: data.files?.length,
      });
    } catch (err: any) {
      logger.error("Failed to trigger code parse job", {
        error: err.message,
        repository: data.repository,
      });
    }
  }

  return results;
}

/**
 * Handles CLI messages array and performs necessary actions based on message types
 */
async function handleMessageResponse(
  messages: Message[],
  integrationDefinition: IntegrationDefinitionV2,
  workspaceId: string,
  userId: string,
  integrationAccountId?: string,
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
    if (grouped["activity"]) {
      const activities = await handleActivityMessage(
        grouped["activity"],
        integrationAccountId as string,
        userId,
      );

      responses.activities = activities;
    }

    // Handle "state" messages
    if (grouped["state"]) {
      const state = await handleStateMessage(
        grouped["state"],
        integrationAccountId as string,
      );

      responses.state = state;
    }

    // Handle "identifier" messages
    if (grouped["identifier"]) {
      const identifier = await handleIdentifierMessage(
        grouped["identifier"][0],
      );
      return identifier;
    }

    // Handle "account" messages (these may involve Prisma writes)
    if (grouped["account"]) {
      const account = await handleAccountMessage(
        grouped["account"],
        integrationDefinition,
        workspaceId,
        userId,
        integrationAccountId as string,
      );

      responses.account = account;
    }

    // Handle "code_parse_job" messages
    if (grouped["code_parse_job"]) {
      const codeJobs = await handleCodeParseJobMessage(
        grouped["code_parse_job"],
        integrationAccountId as string,
        userId,
        workspaceId,
      );

      responses.codeJobs = codeJobs;
    }

    const unhandled: Message[] = [];
    // Warn for unknown message types
    for (const type of Object.keys(grouped)) {
      if (!["activity", "state", "identifier", "account", "code_parse_job"].includes(type)) {
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

// Remove old event-based handlers as they are replaced by message-type handlers above

export const integrationRun = task({
  id: "integration-run",
  run: async ({
    eventBody,
    integrationAccount,
    integrationDefinition,
    event,
    workspaceId,
    userId,
  }: {
    // This is the event you want to pass to the integration
    event: IntegrationEventType;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    eventBody?: any;
    integrationDefinition: IntegrationDefinitionV2;
    integrationAccount?: IntegrationAccount;
    workspaceId?: string;
    userId?: string;
  }) => {
    try {
      logger.info(
        `Starting integration run for ${integrationDefinition.slug}`,
        {
          event,
          integrationId: integrationDefinition.id,
        },
      );

      // Load the integration file from a URL or a local path
      const spec = integrationDefinition.spec as any;
      const integrationSource = spec?.integration_path || integrationDefinition.url as string;
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
      const messages = extractMessagesFromOutput(output);

      logger.info("Integration run completed", {
        messageCount: messages.length,
        messageTypes: messages.map((m) => m.type),
      });

      // Handle all CLI messages through the generic handler
      return await handleMessageResponse(
        messages,
        integrationDefinition,
        workspaceId as string,
        userId as string,
        integrationAccount?.id,
      );
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
        error: errorMessage,
        errors: [errorMessage],
      };
    }
  },
});
