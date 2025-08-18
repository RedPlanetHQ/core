import { type CoreMessage } from "ai";
import { z } from "zod";

export type BatchStatus = "pending" | "processing" | "completed" | "failed" | "cancelled";

export interface BatchRequest {
  customId: string;
  messages: CoreMessage[];
  systemPrompt?: string;
  options?: any;
}

export interface BatchResponse<T = any> {
  customId: string;
  response?: T;
  error?: BatchError;
}

export interface BatchError {
  code: string;
  message: string;
  type: "validation_error" | "api_error" | "timeout_error" | "rate_limit_error" | "unknown_error";
}

export interface BatchJob {
  batchId: string;
  status: BatchStatus;
  totalRequests: number;
  completedRequests?: number;
  failedRequests?: number;
  createdAt: Date;
  completedAt?: Date;
  results?: BatchResponse[];
  errors?: BatchError[];
}

export interface CreateBatchParams<T = any> {
  requests: BatchRequest[];
  outputSchema?: z.ZodSchema<T>;
  maxRetries?: number;
  timeoutMs?: number;
}

export interface GetBatchParams {
  batchId: string;
}

export interface BatchProvider {
  createBatch<T>(params: CreateBatchParams<T>): Promise<{ batchId: string }>;
  getBatch<T>(params: GetBatchParams): Promise<BatchJob>;
  cancelBatch?(params: GetBatchParams): Promise<{ success: boolean }>;
  supportedModels: string[];
  providerName: string;
}

// Zod schemas for validation
export const BatchRequestSchema = z.object({
  customId: z.string(),
  messages: z.array(z.any()),
  systemPrompt: z.string().optional(),
  options: z.any().optional(),
});

export const BatchResponseSchema = z.object({
  customId: z.string(),
  response: z.any().optional(),
  error: z.object({
    code: z.string(),
    message: z.string(),
    type: z.enum(["validation_error", "api_error", "timeout_error", "rate_limit_error", "unknown_error"]),
  }).optional(),
});

export const CreateBatchParamsSchema = z.object({
  requests: z.array(BatchRequestSchema),
  outputSchema: z.any().optional(),
  maxRetries: z.number().optional(),
  timeoutMs: z.number().optional(),
});