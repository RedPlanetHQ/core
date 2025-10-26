/* eslint-disable @typescript-eslint/no-explicit-any */
import { logger } from "@trigger.dev/sdk/v3";

import * as fs from "fs";
import * as path from "path";

import { prisma } from "./prisma";

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
