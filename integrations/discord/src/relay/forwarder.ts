import axios, { AxiosError, AxiosInstance } from 'axios';

import type { RelayEvent } from './events';

export interface ForwarderOptions {
  webhookUrl: string;
  workspaceToken: string;
  relayId?: string;
  maxAttempts?: number;
  initialBackoffMs?: number;
  timeoutMs?: number;
}

const DEFAULT_MAX_ATTEMPTS = 5;
const DEFAULT_INITIAL_BACKOFF_MS = 500;
const DEFAULT_TIMEOUT_MS = 10_000;

export class Forwarder {
  private client: AxiosInstance;
  private maxAttempts: number;
  private initialBackoffMs: number;

  constructor(private options: ForwarderOptions) {
    this.maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
    this.initialBackoffMs = options.initialBackoffMs ?? DEFAULT_INITIAL_BACKOFF_MS;
    this.client = axios.create({
      baseURL: options.webhookUrl,
      timeout: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      headers: {
        Authorization: `Bearer ${options.workspaceToken}`,
        'Content-Type': 'application/json',
        ...(options.relayId ? { 'X-Core-Relay-Id': options.relayId } : {}),
      },
      validateStatus: () => true, // we inspect status manually
    });
  }

  async forward(event: RelayEvent): Promise<void> {
    let attempt = 0;
    let lastError: unknown = null;

    while (attempt < this.maxAttempts) {
      attempt += 1;
      try {
        const response = await this.client.post('', event, {
          headers: {
            'X-Idempotency-Key': event.event_id,
          },
        });

        if (response.status >= 200 && response.status < 300) {
          return;
        }

        // Auth or client errors — don't retry.
        if (response.status === 401 || response.status === 403) {
          throw new Error(
            `Forwarder auth rejected (${response.status}): check CORE_WORKSPACE_TOKEN`,
          );
        }

        if (response.status >= 400 && response.status < 500) {
          throw new Error(
            `Forwarder rejected with ${response.status}: ${JSON.stringify(response.data)}`,
          );
        }

        lastError = new Error(`Forwarder ${response.status}: ${JSON.stringify(response.data)}`);
      } catch (error) {
        lastError = error;
        const ax = error as AxiosError;
        // For network errors (no response), retry. For thrown 4xx errors (above), bail.
        if (ax?.response && ax.response.status >= 400 && ax.response.status < 500) {
          throw error;
        }
      }

      if (attempt < this.maxAttempts) {
        const backoff = this.initialBackoffMs * 2 ** (attempt - 1);
        await sleep(backoff);
      }
    }

    throw new Error(
      `Forwarder failed after ${this.maxAttempts} attempts: ${(lastError as Error)?.message ?? 'unknown'}`,
    );
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
