import { logger } from "~/services/logger.service";
import { isBurstSensitiveChatProvider } from "~/services/llm-provider.server";

const BURST_RETRY_DELAYS_MS = [5000, 15000];

function isBurstRetryableError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;

  const candidate = error as {
    statusCode?: number;
    responseBody?: string;
    cause?: unknown;
  };

  if (candidate.statusCode === 429) return true;
  if (
    typeof candidate.responseBody === "string" &&
    candidate.responseBody.includes('"code":"1305"')
  ) {
    return true;
  }

  return isBurstRetryableError(candidate.cause);
}

export async function runWithBurstRetry<T>(
  label: string,
  operation: () => Promise<T>,
): Promise<T> {
  if (!isBurstSensitiveChatProvider()) {
    return operation();
  }

  let attempt = 0;

  while (true) {
    try {
      return await operation();
    } catch (error) {
      if (
        !isBurstRetryableError(error) ||
        attempt >= BURST_RETRY_DELAYS_MS.length
      ) {
        throw error;
      }

      const delayMs = BURST_RETRY_DELAYS_MS[attempt];
      attempt += 1;

      logger.warn(`[burst-retry] ${label} hit 429/overload; retrying`, {
        attempt,
        delayMs,
      });

      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}
