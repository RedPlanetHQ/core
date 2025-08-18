import { type BatchProvider, type CreateBatchParams, type GetBatchParams, type BatchJob, type BatchError } from "./types";

export abstract class BaseBatchProvider implements BatchProvider {
  abstract providerName: string;
  abstract supportedModels: string[];

  abstract createBatch<T>(params: CreateBatchParams<T>): Promise<{ batchId: string }>;
  abstract getBatch<T>(params: GetBatchParams): Promise<BatchJob>;

  // Optional methods with default implementations
  async cancelBatch(params: GetBatchParams): Promise<{ success: boolean }> {
    throw new Error(`Cancel batch not supported by ${this.providerName} provider`);
  }

  // Utility methods for all providers
  protected generateBatchId(): string {
    return `batch_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  protected createError(code: string, message: string, type: BatchError["type"] = "unknown_error"): BatchError {
    return { code, message, type };
  }

  protected validateRequests(requests: any[]): void {
    if (!Array.isArray(requests) || requests.length === 0) {
      throw new Error("Requests must be a non-empty array");
    }

    const customIds = new Set();
    for (const request of requests) {
      if (!request.customId) {
        throw new Error("Each request must have a customId");
      }
      if (customIds.has(request.customId)) {
        throw new Error(`Duplicate customId found: ${request.customId}`);
      }
      customIds.add(request.customId);
    }
  }

  protected isModelSupported(modelId: string): boolean {
    return this.supportedModels.includes(modelId) || 
           this.supportedModels.some(pattern => {
             if (pattern.includes("*")) {
               const regex = new RegExp(pattern.replace(/\*/g, ".*"));
               return regex.test(modelId);
             }
             return false;
           });
  }
}