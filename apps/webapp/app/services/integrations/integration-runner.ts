import * as fs from "fs";
import * as path from "path";
import { pathToFileURL } from "node:url";

import { prisma } from "~/db.server";
import { logger } from "~/services/logger.service";
import type {
  IntegrationDefinitionV2,
  IntegrationAccount,
} from "@core/database";
import {
  IntegrationEventType,
  type IntegrationEventPayload,
  type Message,
} from "@core/types";
import { createActivities } from "~/trigger/utils/message-utils";

// Cache: slug -> { mod, version }
const moduleCache = new Map<
  string,
  { run: (payload: IntegrationEventPayload) => Promise<Message[]> }
>();
// Per-slug version counter for cache-busting ESM imports
const moduleVersions = new Map<string, number>();

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

export class IntegrationRunner {
  /**
   * Load/download integration definitions that don't have a workspaceId (global integrations)
   * This should be called on server startup
   */
  static async load(): Promise<void> {
    logger.debug("Starting integration definitions load process");

    let integrationDefinitions: IntegrationDefinitionV2[] = [];

    try {
      integrationDefinitions = await prisma.integrationDefinitionV2.findMany({
        where: { deleted: null, workspaceId: null },
      });
    } catch (error) {
      logger.error("Failed to fetch integration definitions:", { error });
      return;
    }

    logger.debug(
      `Found ${integrationDefinitions.length} global integration definitions`,
    );

    for (const integration of integrationDefinitions) {
      try {
        await this.downloadIntegration(integration);
      } catch (error) {
        logger.error(`Error processing integration ${integration.slug}:`, {
          error,
        });
        // Continue loading remaining integrations
      }
    }

    logger.debug("Completed integration definitions load process");
  }

  /**
   * Download a single integration file from its URL or copy from local path
   */
  private static async downloadIntegration(
    integration: IntegrationDefinitionV2,
  ): Promise<void> {
    logger.debug(`Processing integration: ${integration.slug}`);

    const integrationDir = path.join(
      process.cwd(),
      "integrations",
      integration.slug,
    );
    const targetFile = path.join(integrationDir, "main.mjs");

    if (!fs.existsSync(integrationDir)) {
      fs.mkdirSync(integrationDir, { recursive: true });
    }

    if (fs.existsSync(targetFile)) {
      logger.debug(`Integration ${integration.slug} already exists, skipping`);
      return;
    }

    const urlOrPath = integration.url as string;
    if (!urlOrPath) {
      logger.warn(`Integration ${integration.slug} has no URL, skipping`);
      return;
    }

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

  private static async downloadFromUrl(
    url: string,
    targetFile: string,
    slug: string,
  ): Promise<void> {
    logger.debug(`Fetching content from URL: ${url}`);
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(
        `Failed to fetch integration ${slug}: ${response.status} ${response.statusText}`,
      );
    }

    const content = await response.text();
    fs.writeFileSync(targetFile, content);
    logger.debug(`Successfully saved integration: ${slug}`);
  }

  private static async copyFromLocalPath(
    sourcePath: string,
    targetFile: string,
    slug: string,
  ): Promise<void> {
    const absoluteSourcePath = path.isAbsolute(sourcePath)
      ? sourcePath
      : path.join(process.cwd(), sourcePath);

    if (!fs.existsSync(absoluteSourcePath)) {
      throw new Error(
        `Integration source file not found: ${absoluteSourcePath}`,
      );
    }

    fs.copyFileSync(absoluteSourcePath, targetFile);
    logger.debug(`Successfully copied integration: ${slug}`);
  }

  private static getModulePath(slug: string): string {
    return path.resolve(process.cwd(), "integrations", slug, "main.mjs");
  }

  /**
   * Load (or return cached) integration module via dynamic import
   */
  private static async loadModule(slug: string) {
    if (moduleCache.has(slug)) {
      return moduleCache.get(slug)!;
    }

    const modulePath = this.getModulePath(slug);

    if (!fs.existsSync(modulePath)) {
      logger.info(
        `Integration module not found for ${slug}, attempting on-demand download`,
      );
      const integrationDefinition =
        await prisma.integrationDefinitionV2.findFirst({
          where: { slug, deleted: null },
        });

      if (!integrationDefinition) {
        throw new Error(`Integration definition not found for slug: ${slug}`);
      }

      await this.downloadIntegration(integrationDefinition);

      if (!fs.existsSync(modulePath)) {
        throw new Error(
          `Integration module not found after download: ${modulePath}`,
        );
      }
    }

    const version = moduleVersions.get(slug) ?? 0;
    const fileUrl = pathToFileURL(modulePath).href + `?v=${version}`;
    const mod = await import(fileUrl);

    if (typeof mod.run !== "function") {
      throw new Error(`Integration ${slug} does not export a run() function`);
    }

    moduleCache.set(slug, mod);
    return mod;
  }

  /**
   * Invalidate the cached module for a slug (e.g. after update)
   */
  static invalidateCache(slug: string): void {
    moduleCache.delete(slug);
    moduleVersions.set(slug, (moduleVersions.get(slug) ?? 0) + 1);
  }

  private static async executeModule(
    payload: IntegrationEventPayload,
    slug: string,
  ): Promise<Message[]> {
    const mod = await this.loadModule(slug);

    return await mod.run(payload);
  }

  static async setup(params: SetupParams): Promise<Message[]> {
    const { eventBody, integrationDefinition } = params;
    const slug = integrationDefinition.slug;

    logger.debug(`Running setup for integration: ${slug}`);

    return this.executeModule(
      {
        event: IntegrationEventType.SETUP,
        eventBody,
        integrationDefinition,
      },
      slug,
    );
  }

  static async identify(params: IdentifyParams): Promise<Message[]> {
    const { webhookData, integrationDefinition } = params;
    const slug = integrationDefinition.slug;

    logger.debug(`Running identify for integration: ${slug}`);

    return this.executeModule(
      {
        event: IntegrationEventType.IDENTIFY,
        eventBody: webhookData,
        integrationDefinition,
      },
      slug,
    );
  }

  static async getTools(params: GetToolsParams): Promise<Message[]> {
    const { config, integrationDefinition } = params;
    const slug = integrationDefinition.slug;

    logger.debug(`Running get-tools for integration: ${slug}`);

    return this.executeModule(
      {
        event: IntegrationEventType.GET_TOOLS,
        eventBody: {},
        config: config || {},
        integrationDefinition,
      },
      slug,
    );
  }

  static async callTool(params: CallToolParams): Promise<Message[]> {
    const { config, integrationDefinition, toolName, toolArguments, timezone } =
      params;
    const slug = integrationDefinition.slug;

    logger.debug(`Running call-tool ${toolName} for integration: ${slug}`);

    return this.executeModule(
      {
        event: IntegrationEventType.CALL_TOOL,
        eventBody: { name: toolName, arguments: toolArguments },
        config: { ...config, timezone: timezone || "UTC" },
        integrationDefinition,
      },
      slug,
    );
  }

  static async process(params: ProcessParams): Promise<Message[]> {
    const { eventData, config, integrationDefinition, state } = params;
    const slug = integrationDefinition.slug;

    logger.debug(`Running process for integration: ${slug}`);

    return this.executeModule(
      {
        event: IntegrationEventType.PROCESS,
        eventBody: eventData,
        config: config || {},
        integrationDefinition,
        state,
      },
      slug,
    );
  }

  /**
   * Handle setup messages and create integration account
   */
  static async handleSetupMessages(
    messages: Message[],
    integrationDefinition: IntegrationDefinitionV2,
    workspaceId: string,
    userId: string,
  ): Promise<{ account?: IntegrationAccount }> {
    const result: { account?: IntegrationAccount } = {};

    const grouped: Record<string, Message[]> = {};
    for (const message of messages) {
      if (!grouped[message.type]) grouped[message.type] = [];
      grouped[message.type].push(message);
    }

    if (grouped["account"]) {
      const message = grouped["account"][0];
      const { settings, config, accountId } = message.data;

      const existingAccount = await prisma.integrationAccount.findFirst({
        where: {
          accountId,
          integrationDefinitionId: integrationDefinition.id,
          workspaceId,
        },
      });

      if (existingAccount) {
        const updatedAccount = await prisma.integrationAccount.update({
          where: { id: existingAccount.id },
          data: { integrationConfiguration: config, settings, isActive: true },
        });
        result.account = updatedAccount;
        logger.info(
          `Updated existing integration account: ${updatedAccount.id}`,
        );
      } else {
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
        logger.debug(`Created new integration account: ${newAccount.id}`);
      }
    }

    return result;
  }

  /**
   * Handle identify messages and return account identifiers
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
   */
  static async handleProcessMessages(
    messages: Message[],
    integrationAccountId: string,
  ): Promise<{ activities: any[]; state?: any }> {
    const result: { activities: any[]; state?: any } = { activities: [] };

    const grouped: Record<string, Message[]> = {};
    for (const message of messages) {
      if (!grouped[message.type]) grouped[message.type] = [];
      grouped[message.type].push(message);
    }

    if (grouped["state"]) {
      const stateMessage = grouped["state"][0];
      const account = await prisma.integrationAccount.findUnique({
        where: { id: integrationAccountId },
      });

      if (account) {
        const currentSettings = (account.settings as any) || {};
        await prisma.integrationAccount.update({
          where: { id: integrationAccountId },
          data: { settings: { ...currentSettings, state: stateMessage.data } },
        });
        result.state = stateMessage.data;
      }
    }

    if (grouped["activity"]) {
      // Persist via the shared helper so the inline webhook path matches the
      // trigger/bullmq paths: writes Activity rows, fans out to webhook
      // subscribers, and enqueues the CASE pipeline when autoActivityRead
      // is enabled. `userId` is unused by the helper — the integration
      // account lookup carries the integratedById it actually needs.
      result.activities = await createActivities({
        integrationAccountId,
        messages: grouped["activity"],
        userId: "",
      });
    }

    return result;
  }
}
