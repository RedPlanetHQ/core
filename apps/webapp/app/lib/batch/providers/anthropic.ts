import Anthropic from "@anthropic-ai/sdk";
import { BaseBatchProvider } from "../base-provider";
import {
  type CreateBatchParams,
  type GetBatchParams,
  type BatchJob,
  type BatchResponse,
  type BatchStatus,
} from "../types";
import { logger } from "~/services/logger.service";

export class AnthropicBatchProvider extends BaseBatchProvider {
  providerName = "anthropic";
  supportedModels = [
    "claude-3-7-sonnet-20250219",
    "claude-3-opus-20240229",
    "claude-3-5-haiku-20241022",
    "claude-3*",
    "claude-2*",
  ];

  private anthropicClient: Anthropic;

  constructor(options?: { apiKey?: string }) {
    super();
    this.anthropicClient = new Anthropic({
      apiKey: options?.apiKey || process.env.ANTHROPIC_API_KEY,
    });
  }

  async createBatch<T>(
    params: CreateBatchParams<T>,
  ): Promise<{ batchId: string }> {
    try {
      this.validateRequests(params.requests);

      // Convert requests to Anthropic batch format
      const batchRequests = params.requests.map((request) => ({
        custom_id: request.customId,
        params: {
          model: process.env.MODEL as string,
          max_tokens: 4096,
          messages: request.systemPrompt
            ? [
                { role: "system" as const, content: request.systemPrompt },
                ...request.messages,
              ]
            : request.messages,
          ...(params.outputSchema && {
            tools: [
              {
                name: "structured_output",
                description: "Output structured data according to schema",
                input_schema: this.zodToJsonSchema(params.outputSchema),
              },
            ],
            tool_choice: { type: "tool", name: "structured_output" },
          }),
          ...request.options,
        },
      }));

      // Create batch using Anthropic's native batch API
      const batch = await this.anthropicClient.messages.batches.create({
        requests: batchRequests,
      });

      logger.info(`Anthropic batch created: ${batch.id}`);
      return { batchId: batch.id };
    } catch (error) {
      logger.error("Anthropic batch creation failed:", { error });
      throw new Error(
        `Failed to create Anthropic batch: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  }

  async getBatch<T>(params: GetBatchParams): Promise<BatchJob> {
    try {
      const batch = await this.anthropicClient.messages.batches.retrieve(
        params.batchId,
      );

      let results: BatchResponse<T>[] = [];

      // If batch is completed, fetch results
      if (batch.processing_status === "ended") {
        try {
          const batchResults =
            await this.anthropicClient.messages.batches.results(params.batchId);

          results = batchResults.map((result) => {
            try {
              if (result.result.type === "succeeded") {
                const message = result.result.message;
                let processedResponse: any =
                  message.content[0]?.text || message.content;

                // If tool was used for structured output, extract from tool response
                if (message.content[0]?.type === "tool_use") {
                  processedResponse = message.content[0].input;
                }

                return {
                  customId: result.custom_id,
                  response: processedResponse,
                };
              } else {
                return {
                  customId: result.custom_id,
                  error: {
                    code: result.result.error?.type || "unknown",
                    message: result.result.error?.message || "Unknown error",
                    type: "api_error" as const,
                  },
                };
              }
            } catch (parseError) {
              logger.error("Failed to parse Anthropic batch result:", {
                parseError,
              });
              return {
                customId: result.custom_id,
                error: {
                  code: "parse_error",
                  message: "Failed to parse batch result",
                  type: "api_error" as const,
                },
              };
            }
          });
        } catch (fetchError) {
          logger.error("Failed to fetch Anthropic batch results:", {
            fetchError,
          });
        }
      }

      return {
        batchId: batch.id,
        status: this.mapAnthropicStatus(batch.processing_status),
        totalRequests:
          batch.request_counts.processing +
          batch.request_counts.succeeded +
          batch.request_counts.errored +
          batch.request_counts.canceled +
          batch.request_counts.expired,
        completedRequests: batch.request_counts.succeeded,
        failedRequests:
          batch.request_counts.errored +
          batch.request_counts.canceled +
          batch.request_counts.expired,
        createdAt: new Date(batch.created_at),
        completedAt: batch.ended_at ? new Date(batch.ended_at) : undefined,
        results: results.length > 0 ? results : undefined,
      };
    } catch (error) {
      logger.error("Failed to get Anthropic batch:", { error });
      throw new Error(
        `Failed to retrieve batch: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  }

  async cancelBatch(params: GetBatchParams): Promise<{ success: boolean }> {
    try {
      await this.anthropicClient.messages.batches.cancel(params.batchId);
      logger.info(`Anthropic batch cancelled: ${params.batchId}`);
      return { success: true };
    } catch (error) {
      logger.error("Failed to cancel Anthropic batch:", { error });
      return { success: false };
    }
  }

  private mapAnthropicStatus(status: string): BatchStatus {
    switch (status) {
      case "in_progress":
        return "processing";
      case "ended":
        return "completed";
      case "canceled":
        return "cancelled";
      case "failed":
        return "failed";
      default:
        return "pending";
    }
  }

  // Convert Zod schema to JSON schema for Anthropic tools
  private zodToJsonSchema(schema: any): any {
    // Basic conversion - can be enhanced based on schema complexity
    if (schema._def && schema._def.typeName) {
      switch (schema._def.typeName) {
        case "ZodObject":
          return {
            type: "object",
            properties: Object.fromEntries(
              Object.entries(schema._def.shape()).map(
                ([key, value]: [string, any]) => [
                  key,
                  this.zodToJsonSchema(value),
                ],
              ),
            ),
            required: Object.keys(schema._def.shape()).filter(
              (key) => !schema._def.shape()[key].isOptional?.(),
            ),
          };
        case "ZodString":
          return { type: "string" };
        case "ZodNumber":
          return { type: "number" };
        case "ZodBoolean":
          return { type: "boolean" };
        case "ZodArray":
          return {
            type: "array",
            items: this.zodToJsonSchema(schema._def.type),
          };
        default:
          return { type: "string" };
      }
    }

    // Fallback for basic schemas
    return { type: "string" };
  }
}
