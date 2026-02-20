import { execFile } from "child_process";
import { promisify } from "util";
import * as fs from "fs";
import * as path from "path";

import { prisma } from "~/db.server";
import { logger } from "~/services/logger.service";
import type {
  IntegrationDefinitionV2,
  IntegrationAccount,
} from "@core/database";
import type { Message } from "@core/types";

const execFileAsync = promisify(execFile);

// Timeout for CLI commands (30 seconds)
const CLI_TIMEOUT = 30000;
// Max buffer for CLI output (10MB)
const MAX_BUFFER = 10 * 1024 * 1024;

export interface IntegrationRunnerConfig {
  config?: Record<string, unknown>;
  integrationDefinition: IntegrationDefinitionV2;
  timezone?: string;
}

export interface SetupParams extends IntegrationRunnerConfig {
  eventBody: Record<string, unknown>;
}

export interface IdentifyParams extends IntegrationRunnerConfig {
  webhookData: Record<string, unknown>;
}

export interface GetToolsParams extends IntegrationRunnerConfig {}

export interface CallToolParams extends IntegrationRunnerConfig {
  toolName: string;
  toolArguments: Record<string, unknown>;
}

export interface ProcessParams extends IntegrationRunnerConfig {
  eventData: Record<string, unknown>;
  state?: Record<string, unknown>;
}

/**
 * IntegrationRunner - Centralized service for executing integration CLI commands
 *
 * This service provides a single point of interaction with integration CLIs,
 * handling the download and execution of integration files.
 */
export class IntegrationRunner {
  /**
   * Load/download integration definitions that don't have a workspaceId (global integrations)
   * This should be called on server startup
   */
  static async load(): Promise<void> {
    try {
      logger.info("Starting integration definitions load process");

      // Get all integration definitions without workspaceId (global integrations)
      const integrationDefinitions =
        await prisma.integrationDefinitionV2.findMany({
          where: {
            deleted: null,
            workspaceId: null, // Only global integrations
          },
        });

      logger.info(
        `Found ${integrationDefinitions.length} global integration definitions`,
      );

      for (const integration of integrationDefinitions) {
        try {
          await this.downloadIntegration(integration);
        } catch (error) {
          logger.error(`Error processing integration ${integration.slug}:`, {
            error,
          });
        }
      }

      logger.info("Completed integration definitions load process");
    } catch (error) {
      logger.error("Failed to load integration definitions:", { error });
      throw error;
    }
  }

  /**
   * Download a single integration file from its URL or copy from local path
   */
  private static async downloadIntegration(
    integration: IntegrationDefinitionV2,
  ): Promise<void> {
    logger.info(`Processing integration: ${integration.slug}`);

    const integrationDir = path.join(
      process.cwd(),
      "integrations",
      integration.slug,
    );
    const targetFile = path.join(integrationDir, "main");

    // Create directory if it doesn't exist
    if (!fs.existsSync(integrationDir)) {
      fs.mkdirSync(integrationDir, { recursive: true });
      logger.info(`Created directory: ${integrationDir}`);
    }

    // Skip if file already exists
    if (fs.existsSync(targetFile)) {
      logger.info(`Integration ${integration.slug} already exists, skipping`);
      return;
    }

    const urlOrPath = integration.url as string;
    if (!urlOrPath) {
      logger.warn(`Integration ${integration.slug} has no URL, skipping`);
      return;
    }

    // Check if urlOrPath is a URL or local path
    let isUrl = false;
    try {
      const parsed = new URL(urlOrPath);
      isUrl = ["http:", "https:"].includes(parsed.protocol);
    } catch {
      isUrl = false;
    }

    if (isUrl) {
      await this.downloadFromUrl(urlOrPath, targetFile, integration.slug);
    } else {
      await this.copyFromLocalPath(urlOrPath, targetFile, integration.slug);
    }
  }

  /**
   * Download integration file from URL
   */
  private static async downloadFromUrl(
    url: string,
    targetFile: string,
    slug: string,
  ): Promise<void> {
    logger.info(`Fetching content from URL: ${url}`);
    const response = await fetch(url);

    if (!response.ok) {
      logger.error(
        `Failed to fetch ${url}: ${response.status} ${response.statusText}`,
      );
      throw new Error(`Failed to fetch integration: ${response.status}`);
    }

    // Check if the response is binary or text
    const contentType = response.headers.get("content-type");
    const isBinary =
      contentType &&
      (contentType.includes("application/octet-stream") ||
        contentType.includes("application/executable") ||
        contentType.includes("application/x-executable") ||
        contentType.includes("binary") ||
        !contentType.includes("text/"));

    let content: string | Buffer;

    if (isBinary) {
      const arrayBuffer = await response.arrayBuffer();
      content = Buffer.from(arrayBuffer);
    } else {
      content = await response.text();
    }

    fs.writeFileSync(targetFile, content);

    // Make the file executable on non-Windows systems
    if (process.platform !== "win32") {
      fs.chmodSync(targetFile, "755");
    }

    logger.info(`Successfully saved integration: ${slug} to ${targetFile}`);
  }

  /**
   * Copy integration file from local path
   */
  private static async copyFromLocalPath(
    sourcePath: string,
    targetFile: string,
    slug: string,
  ): Promise<void> {
    const absoluteSourcePath = path.isAbsolute(sourcePath)
      ? sourcePath
      : path.join(process.cwd(), sourcePath);

    logger.info(`Copying content from local path: ${absoluteSourcePath}`);

    if (!fs.existsSync(absoluteSourcePath)) {
      logger.error(`Source file does not exist: ${absoluteSourcePath}`);
      throw new Error(`Source file not found: ${absoluteSourcePath}`);
    }

    fs.copyFileSync(absoluteSourcePath, targetFile);

    // Make the file executable on non-Windows systems
    if (process.platform !== "win32") {
      fs.chmodSync(targetFile, "755");
    }

    logger.info(`Successfully copied integration: ${slug} to ${targetFile}`);
  }

  /**
   * Get the executable path for an integration
   */
  private static getExecutablePath(slug: string): string {
    return `./integrations/${slug}/main`;
  }

  /**
   * Execute a CLI command with common options
   */
  private static async executeCommand(
    args: string[],
    slug: string,
  ): Promise<string> {
    const executablePath = this.getExecutablePath(slug);

    try {
      const { stdout } = await execFileAsync(
        "node",
        [executablePath, ...args],
        {
          encoding: "utf-8",
          maxBuffer: MAX_BUFFER,
          timeout: CLI_TIMEOUT,
        },
      );

      return stdout;
    } catch (error: any) {
      if (error.killed && error.signal === "SIGTERM") {
        throw new Error(
          `Integration command timeout: ${slug} exceeded ${CLI_TIMEOUT / 1000} seconds`,
        );
      }
      throw error;
    }
  }

  /**
   * Run setup command for an integration
   * Used during OAuth flow to configure an integration account
   */
  static async setup(params: SetupParams): Promise<any> {
    const { eventBody, integrationDefinition } = params;
    const slug = integrationDefinition.slug;

    logger.info(`Running setup for integration: ${slug}`);

    const stdout = await this.executeCommand(
      [
        "setup",
        "--event-body",
        JSON.stringify(eventBody),
        "--integration-definition",
        JSON.stringify(integrationDefinition),
      ],
      slug,
    );

    // Parse output - each line is a JSON message
    const messages = stdout
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line));

    return messages;
  }

  /**
   * Run identify command for an integration
   * Used to identify which account a webhook belongs to
   */
  static async identify(params: IdentifyParams): Promise<any> {
    const { webhookData, integrationDefinition } = params;
    const slug = integrationDefinition.slug;

    logger.info(`Running identify for integration: ${slug}`);

    const stdout = await this.executeCommand(
      [
        "identify",
        "--webhook-data",
        JSON.stringify(webhookData),
        "--integration-definition",
        JSON.stringify(integrationDefinition),
      ],
      slug,
    );

    // Parse output - each line is a JSON message
    const messages = stdout
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line));

    return messages;
  }

  /**
   * Run get-tools command for an integration
   * Returns the list of MCP tools available for this integration
   */
  static async getTools(params: GetToolsParams): Promise<any> {
    const { config, integrationDefinition } = params;
    const slug = integrationDefinition.slug;

    logger.info(`Running get-tools for integration: ${slug}`);

    const stdout = await this.executeCommand(
      [
        "get-tools",
        "--config",
        JSON.stringify(config || {}),
        "--integration-definition",
        JSON.stringify(integrationDefinition),
      ],
      slug,
    );

    // get-tools returns a JSON array directly
    return JSON.parse(stdout);
  }

  /**
   * Run call-tool command for an integration
   * Executes a specific MCP tool on the integration
   */
  static async callTool(params: CallToolParams): Promise<any> {
    const { config, integrationDefinition, toolName, toolArguments, timezone } =
      params;
    const slug = integrationDefinition.slug;

    logger.info(`Running call-tool ${toolName} for integration: ${slug}`);

    const configWithTimezone = {
      ...config,
      timezone: timezone || "UTC",
    };

    const stdout = await this.executeCommand(
      [
        "call-tool",
        "--config",
        JSON.stringify(configWithTimezone),
        "--integration-definition",
        JSON.stringify(integrationDefinition),
        "--tool-name",
        toolName,
        "--tool-arguments",
        JSON.stringify(toolArguments),
      ],
      slug,
    );

    // call-tool returns a JSON array directly
    return JSON.parse(stdout);
  }

  /**
   * Run process command for an integration
   * Processes webhook/event data from the integration
   */
  static async process(params: ProcessParams): Promise<any> {
    const { eventData, config, integrationDefinition, state } = params;
    const slug = integrationDefinition.slug;

    logger.info(`Running process for integration: ${slug}`);

    const stdout = await this.executeCommand(
      [
        "process",
        "--event-data",
        JSON.stringify(eventData),
        "--config",
        JSON.stringify(config || {}),
        ...(state ? ["--state", JSON.stringify(state)] : []),
      ],
      slug,
    );

    // Parse output - each line is a JSON message
    const messages = stdout
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line));

    return messages;
  }

  /**
   * Handle setup messages and create integration account
   * Processes messages returned by setup() command
   */
  static async handleSetupMessages(
    messages: Message[],
    integrationDefinition: IntegrationDefinitionV2,
    workspaceId: string,
    userId: string,
  ): Promise<{ account?: IntegrationAccount }> {
    const result: { account?: IntegrationAccount } = {};

    // Group messages by type
    const grouped: Record<string, Message[]> = {};
    for (const message of messages) {
      if (!grouped[message.type]) {
        grouped[message.type] = [];
      }
      grouped[message.type].push(message);
    }

    // Handle "account" messages - create integration account
    if (grouped["account"]) {
      const message = grouped["account"][0];
      const { settings, config, accountId } = message.data;

      // Check if account already exists
      const existingAccount = await prisma.integrationAccount.findFirst({
        where: {
          accountId,
          integrationDefinitionId: integrationDefinition.id,
          workspaceId,
        },
      });

      if (existingAccount) {
        // Update existing account
        const updatedAccount = await prisma.integrationAccount.update({
          where: { id: existingAccount.id },
          data: {
            integrationConfiguration: config,
            settings,
            isActive: true,
          },
        });
        result.account = updatedAccount;
        logger.info(
          `Updated existing integration account: ${updatedAccount.id}`,
        );
      } else {
        // Create new account
        const newAccount = await prisma.integrationAccount.create({
          data: {
            integrationDefinitionId: integrationDefinition.id,
            workspaceId,
            integratedById: userId,
            accountId,
            integrationConfiguration: config,
            settings,
            isActive: true,
          },
        });
        result.account = newAccount;
        logger.info(`Created new integration account: ${newAccount.id}`);
      }
    }

    return result;
  }

  /**
   * Handle identify messages and return account identifiers
   * Processes messages returned by identify() command
   */
  static handleIdentifyMessages(messages: Message[]): {
    identifiers: { id: string }[];
  } {
    const identifiers: { id: string }[] = [];

    for (const message of messages) {
      if (message.type === "identifier") {
        identifiers.push({ id: message.data });
      }
    }

    return { identifiers };
  }

  /**
   * Handle process messages - creates activities and saves state
   * Processes messages returned by process() command
   */
  static async handleProcessMessages(
    messages: Message[],
    integrationAccountId: string,
  ): Promise<{ activities: any[]; state?: any }> {
    const result: { activities: any[]; state?: any } = { activities: [] };

    // Group messages by type
    const grouped: Record<string, Message[]> = {};
    for (const message of messages) {
      if (!grouped[message.type]) {
        grouped[message.type] = [];
      }
      grouped[message.type].push(message);
    }

    // Handle "state" messages - save state to integration account settings
    if (grouped["state"]) {
      const stateMessage = grouped["state"][0];
      const account = await prisma.integrationAccount.findUnique({
        where: { id: integrationAccountId },
      });

      if (account) {
        const currentSettings = (account.settings as any) || {};
        await prisma.integrationAccount.update({
          where: { id: integrationAccountId },
          data: {
            settings: {
              ...currentSettings,
              state: stateMessage.data,
            },
          },
        });
        result.state = stateMessage.data;
      }
    }

    // Handle "activity" messages - return them for further processing
    if (grouped["activity"]) {
      result.activities = grouped["activity"].map((m) => m.data);
    }

    return result;
  }
}
