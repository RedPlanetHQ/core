/* eslint-disable @typescript-eslint/no-explicit-any */
import { logger } from "@trigger.dev/sdk/v3";
import { jsonSchema, tool, type ToolSet } from "ai";
import * as fs from "fs";
import * as path from "path";

import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { prisma } from "./prisma";

export const configureStdioMCPEnvironment = (
  spec: any,
  account: any,
): { env: Record<string, string>; args: any[] } => {
  if (!spec.mcp) {
    return { env: {}, args: [] };
  }

  const mcpSpec = spec.mcp;
  const configuredMCP = { ...mcpSpec };

  // Replace config placeholders in environment variables
  if (configuredMCP.env) {
    for (const [key, value] of Object.entries(configuredMCP.env)) {
      if (typeof value === "string" && value.includes("${config:")) {
        // Extract the config key from the placeholder
        const configKey = value.match(/\$\{config:(.*?)\}/)?.[1];
        if (
          configKey &&
          account.integrationConfiguration &&
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (account.integrationConfiguration as any)[configKey]
        ) {
          configuredMCP.env[key] = value.replace(
            `\${config:${configKey}}`,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (account.integrationConfiguration as any)[configKey],
          );
        }
      }

      if (typeof value === "string" && value.includes("${integrationConfig:")) {
        // Extract the config key from the placeholder
        const configKey = value.match(/\$\{integrationConfig:(.*?)\}/)?.[1];
        if (
          configKey &&
          account.integrationDefinition.config &&
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (account.integrationDefinition.config as any)[configKey]
        ) {
          configuredMCP.env[key] = value.replace(
            `\${integrationConfig:${configKey}}`,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (account.integrationDefinition.config as any)[configKey],
          );
        }
      }
    }
  }

  return {
    env: configuredMCP.env || {},
    args: Array.isArray(configuredMCP.args) ? configuredMCP.args : [],
  };
};

export class MCP {
  private Client: any;
  private client: any = {};

  constructor() {}

  public async init() {
    this.Client = await MCP.importClient();
  }

  private static async importClient() {
    const { Client } = await import(
      "@modelcontextprotocol/sdk/client/index.js"
    );
    return Client;
  }

  async load(headers: any) {
    return await this.connectToServer(
      `${process.env.API_BASE_URL}/api/v1/mcp?source=core`,
      headers,
    );
  }

  async allTools(): Promise<ToolSet> {
    try {
      const { tools } = await this.client.listTools();

      const finalTools: ToolSet = {};

      tools.map(({ name, description, inputSchema }: any) => {
        finalTools[name] = tool({
          description,
          parameters: jsonSchema(inputSchema),
        });
      });

      return finalTools;
    } catch (error) {
      return {};
    }

    // Flatten and convert to object
  }

  async getTool(name: string) {
    try {
      const { tools: clientTools } = await this.client.listTools();
      const clientTool = clientTools.find((to: any) => to.name === name);

      return JSON.stringify(clientTool);
    } catch (e) {
      logger.error((e as string) ?? "Getting tool failed");
      throw new Error("Getting tool failed");
    }
  }

  async callTool(name: string, parameters: any) {
    const response = await this.client.callTool({
      name,
      arguments: parameters,
    });

    return response;
  }

  async connectToServer(url: string, headers: any) {
    try {
      const client = new this.Client(
        {
          name: "Core",
          version: "1.0.0",
        },
        {
          capabilities: {},
        },
      );

      // Configure the transport for MCP server
      const transport = new StreamableHTTPClientTransport(new URL(url), {
        requestInit: { headers },
      });

      // Connect to the MCP server
      await client.connect(transport, { timeout: 60 * 1000 * 5 });
      this.client = client;

      logger.info(`Connected to MCP server`);
    } catch (e) {
      logger.error(`Failed to connect to MCP server: `, { e });
      throw e;
    }
  }
}

export const fetchAndSaveStdioIntegrations = async () => {
  try {
    logger.info("Starting stdio integrations fetch and save process");

    // Get all integration definitions
    const integrationDefinitions =
      await prisma.integrationDefinitionV2.findMany({
        where: {
          deleted: null, // Only active integrations
        },
      });

    logger.info(
      `Found ${integrationDefinitions.length} integration definitions`,
    );

    for (const integration of integrationDefinitions) {
      try {
        const spec = integration.spec as any;

        // Check if this integration has MCP config and is stdio type
        if (spec?.mcp?.type === "stdio" && spec?.mcp?.url) {
          logger.info(`Processing stdio integration: ${integration.slug}`);

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
            logger.info(
              `Integration ${integration.slug} already exists, skipping`,
            );
            continue;
          }

          const urlOrPath = spec.mcp.url;

          // If urlOrPath looks like a URL, use fetch, otherwise treat as local path
          let isUrl = false;
          try {
            // Try to parse as URL
            const parsed = new URL(urlOrPath);
            isUrl = ["http:", "https:"].includes(parsed.protocol);
          } catch {
            isUrl = false;
          }

          if (isUrl) {
            // Fetch the URL content
            logger.info(`Fetching content from URL: ${urlOrPath}`);
            const response = await fetch(urlOrPath);

            if (!response.ok) {
              logger.error(
                `Failed to fetch ${urlOrPath}: ${response.status} ${response.statusText}`,
              );
              continue;
            }

            // Check if the response is binary (executable) or text
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
              // Handle binary files
              const arrayBuffer = await response.arrayBuffer();
              content = Buffer.from(arrayBuffer);
            } else {
              // Handle text files
              content = await response.text();
            }

            // Save the content to the target file
            if (typeof content === "string") {
              fs.writeFileSync(targetFile, content);
            } else {
              fs.writeFileSync(targetFile, content);
            }

            // Make the file executable if it's a script
            if (process.platform !== "win32") {
              fs.chmodSync(targetFile, "755");
            }

            logger.info(
              `Successfully saved stdio integration: ${integration.slug} to ${targetFile}`,
            );
          } else {
            // Treat as local file path
            const sourcePath = path.isAbsolute(urlOrPath)
              ? urlOrPath
              : path.join(process.cwd(), urlOrPath);

            logger.info(`Copying content from local path: ${sourcePath}`);

            if (!fs.existsSync(sourcePath)) {
              logger.error(`Source file does not exist: ${sourcePath}`);
              continue;
            }

            fs.copyFileSync(sourcePath, targetFile);

            // Make the file executable if it's a script
            if (process.platform !== "win32") {
              fs.chmodSync(targetFile, "755");
            }

            logger.info(
              `Successfully copied stdio integration: ${integration.slug} to ${targetFile}`,
            );
          }
        } else {
          logger.debug(
            `Skipping integration ${integration.slug}: not a stdio type or missing URL`,
          );
        }
      } catch (error) {
        logger.error(`Error processing integration ${integration.slug}:`, {
          error,
        });
      }
    }

    logger.info("Completed stdio integrations fetch and save process");
  } catch (error) {
    logger.error("Failed to fetch and save stdio integrations:", { error });
    throw error;
  }
};
