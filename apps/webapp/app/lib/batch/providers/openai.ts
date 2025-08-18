import OpenAI from "openai";
import fs from "fs";
import path from "path";
import os from "os";
import { BaseBatchProvider } from "../base-provider";
import {
  type CreateBatchParams,
  type GetBatchParams,
  type BatchJob,
  type BatchStatus,
  type BatchResponse,
} from "../types";
import { logger } from "~/services/logger.service";

export class OpenAIBatchProvider extends BaseBatchProvider {
  providerName = "openai";
  supportedModels = [
    "gpt-4.1-2025-04-14",
    "gpt-4.1-mini-2025-04-14",
    "gpt-4.1-nano-2025-04-14",
    "gpt-4o*",
    "gpt-4*",
    "gpt-3.5*",
  ];

  private openaiClient: OpenAI;

  constructor(options?: { apiKey?: string }) {
    super();
    this.openaiClient = new OpenAI({
      apiKey: options?.apiKey || process.env.OPENAI_API_KEY,
    });
  }

  async createBatch<T>(
    params: CreateBatchParams<T>,
  ): Promise<{ batchId: string }> {
    try {
      this.validateRequests(params.requests);

      // Convert requests to OpenAI batch format
      const batchRequests = params.requests.map((request, index) => ({
        custom_id: request.customId,
        method: "POST" as const,
        url: "/v1/chat/completions",
        body: {
          model: process.env.MODEL as string,
          messages: request.systemPrompt
            ? [
                { role: "system" as const, content: request.systemPrompt },
                ...request.messages,
              ]
            : request.messages,
          ...request.options,
          // Add response_format for structured output if schema provided
          ...(params.outputSchema && {
            response_format: {
              type: "json_schema" as const,
              json_schema: {
                name: "structured_output",
                strict: true,
                schema: this.zodToJsonSchema(params.outputSchema),
              },
            },
          }),
        },
      }));

      // Create JSONL content
      const jsonlContent = batchRequests
        .map((req) => JSON.stringify(req))
        .join("\n");

      // Create temporary JSONL file
      const tempDir = os.tmpdir();
      const tempFilePath = path.join(
        tempDir,
        `openai-batch-${Date.now()}.jsonl`,
      );

      let file;
      try {
        // Write JSONL content to temporary file
        await fs.promises.writeFile(tempFilePath, jsonlContent, "utf-8");

        console.log("JSONL content:", jsonlContent);
        // Upload file to OpenAI
        file = await this.openaiClient.files.create({
          file: fs.createReadStream(tempFilePath),
          purpose: "batch",
        });

        // Clean up temporary file
        await fs.promises.unlink(tempFilePath);
      } catch (error) {
        // Clean up temporary file on error
        try {
          await fs.promises.unlink(tempFilePath);
        } catch (unlinkError) {
          // Ignore unlink errors
        }
        throw error;
      }

      // Create batch
      const batch = await this.openaiClient.batches.create({
        input_file_id: file.id,
        endpoint: "/v1/chat/completions",
        completion_window: "24h",
      });

      logger.info(`OpenAI batch created: ${batch.id}`);
      return { batchId: batch.id };
    } catch (error) {
      logger.error("OpenAI batch creation failed:", { error });
      throw new Error(
        `Failed to create OpenAI batch: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  }

  async getBatch<T>(params: GetBatchParams): Promise<BatchJob> {
    try {
      const batch = await this.openaiClient.batches.retrieve(params.batchId);

      let results: BatchResponse<T>[] = [];

      // If batch is completed, fetch results
      if (batch.status === "completed" && batch.output_file_id) {
        try {
          const outputFile = await this.openaiClient.files.content(
            batch.output_file_id,
          );
          const outputText = await outputFile.text();

          console.log("Output text:", outputText);
          results = outputText
            .split("\n")
            .filter((line: string) => line.trim())
            .map((line: string) => {
              try {
                const result = JSON.parse(line);
                let processedResponse =
                  result.response?.body?.choices?.[0]?.message?.content ||
                  result.response?.body;

                // Handle structured output - parse JSON content if it's a string
                if (typeof processedResponse === "string") {
                  try {
                    const parsed = JSON.parse(processedResponse);
                    // If we have structured output with results wrapper, extract the results array
                    if (
                      parsed &&
                      typeof parsed === "object" &&
                      parsed.results
                    ) {
                      processedResponse = parsed.results;
                    } else {
                      processedResponse = parsed;
                    }
                  } catch (parseError) {
                    // Keep original string if parsing fails
                    logger.warn("Failed to parse structured output JSON:", {
                      parseError,
                    });
                  }
                }
                // If we have structured output object, extract the results array
                else if (
                  typeof processedResponse === "object" &&
                  processedResponse.results
                ) {
                  processedResponse = processedResponse.results;
                }

                return {
                  customId: result.custom_id,
                  response: processedResponse,
                  error: result.error
                    ? {
                        code: result.error.code || "unknown",
                        message: result.error.message || "Unknown error",
                        type: "api_error" as const,
                      }
                    : undefined,
                };
              } catch (parseError) {
                logger.error("Failed to parse batch result:", { parseError });
                return {
                  customId: "unknown",
                  error: {
                    code: "parse_error",
                    message: "Failed to parse batch result",
                    type: "api_error" as const,
                  },
                };
              }
            });
        } catch (fetchError) {
          logger.error("Failed to fetch batch results:", { fetchError });
        }
      } else if (batch.request_counts?.failed) {
        console.log("Batch failed:", { batch });

        // Fetch error details if error file is available
        if (batch.error_file_id) {
          try {
            const errorFile = await this.openaiClient.files.content(
              batch.error_file_id,
            );
            const errorText = await errorFile.text();
            console.log("Batch error details:", errorText);
            logger.error("OpenAI batch errors:", { errorText });
          } catch (errorFetchError) {
            logger.error("Failed to fetch batch error file:", {
              errorFetchError,
            });
          }
        }

        return {
          batchId: batch.id,
          status: this.mapOpenAIStatus(batch.status),
          totalRequests: batch.request_counts?.total || 0,
          completedRequests: batch.request_counts?.completed || 0,
          failedRequests: batch.request_counts?.failed || 0,
          createdAt: new Date(batch.created_at * 1000),
          completedAt: batch.completed_at
            ? new Date(batch.completed_at * 1000)
            : undefined,
          results: results.length > 0 ? results : undefined,
        };
      }

      const batchJob: BatchJob = {
        batchId: batch.id,
        status: this.mapOpenAIStatus(batch.status),
        totalRequests: batch.request_counts?.total || 0,
        completedRequests: batch.request_counts?.completed || 0,
        failedRequests: batch.request_counts?.failed || 0,
        createdAt: new Date(batch.created_at * 1000),
        completedAt: batch.completed_at
          ? new Date(batch.completed_at * 1000)
          : undefined,
        results: results.length > 0 ? results : undefined,
      };
      console.log("Batch job:", batchJob);
      return batchJob;
    } catch (error) {
      logger.error("Failed to get OpenAI batch:", { error });
      throw new Error(
        `Failed to retrieve batch: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  }

  async cancelBatch(params: GetBatchParams): Promise<{ success: boolean }> {
    try {
      await this.openaiClient.batches.cancel(params.batchId);
      logger.info(`OpenAI batch cancelled: ${params.batchId}`);
      return { success: true };
    } catch (error) {
      logger.error("Failed to cancel OpenAI batch:", { error });
      return { success: false };
    }
  }

  private mapOpenAIStatus(status: string): BatchStatus {
    switch (status) {
      case "validating":
      case "in_progress":
        return "processing";
      case "finalizing":
        return "processing";
      case "completed":
        return "completed";
      case "failed":
      case "expired":
        return "failed";
      case "cancelled":
      case "cancelling":
        return "cancelled";
      default:
        return "pending";
    }
  }

  // Convert Zod schema to JSON schema for OpenAI structured output
  private zodToJsonSchema(schema: any): any {
    // OpenAI requires top-level schema to be an object, so wrap arrays
    if (schema._def && schema._def.typeName === "ZodArray") {
      return {
        type: "object",
        properties: {
          results: {
            type: "array",
            items: this.zodToJsonSchemaInternal(schema._def.type),
          },
        },
        required: ["results"],
        additionalProperties: false,
      };
    }

    return this.zodToJsonSchemaInternal(schema);
  }

  private zodToJsonSchemaInternal(schema: any): any {
    // Basic conversion - can be enhanced based on schema complexity
    if (schema._def && schema._def.typeName) {
      switch (schema._def.typeName) {
        case "ZodArray":
          return {
            type: "array",
            items: this.zodToJsonSchemaInternal(schema._def.type),
          };
        case "ZodObject":
          return {
            type: "object",
            properties: Object.fromEntries(
              Object.entries(schema._def.shape()).map(
                ([key, value]: [string, any]) => [
                  key,
                  this.zodToJsonSchemaInternal(value),
                ],
              ),
            ),
            required: Object.keys(schema._def.shape()).filter(
              (key) => !schema._def.shape()[key].isOptional?.(),
            ),
            additionalProperties: false,
          };
        case "ZodString":
          return { type: "string" };
        case "ZodNumber":
          return { type: "number" };
        case "ZodBoolean":
          return { type: "boolean" };
        default:
          return { type: "string" };
      }
    }

    // Fallback for basic schemas
    return { type: "string" };
  }
}
