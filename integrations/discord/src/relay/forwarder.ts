import axios, { AxiosInstance } from 'axios';

import type { RelayEvent } from './events';

export interface ForwarderOptions {
  webhookUrl: string;
  integrationAccountId: string;
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
  private integrationAccountId: string;

  constructor(private options: ForwarderOptions) {
    this.maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
    this.initialBackoffMs = options.initialBackoffMs ?? DEFAULT_INITIAL_BACKOFF_MS;
    this.integrationAccountId = options.integrationAccountId;
    this.client = axios.create({
      baseURL: options.webhookUrl,
      timeout: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      headers: {
        'Content-Type': 'application/json',
        ...(options.relayId ? { 'X-Core-Relay-Id': options.relayId } : {}),
      },
      validateStatus: () => true,
    });
  }

  async forward(event: RelayEvent): Promise<void> {
    let attempt = 0;
    let lastError: unknown = null;

    while (attempt < this.maxAttempts) {
      attempt += 1;

      let response;
      try {
        response = await this.client.post('', event, {
          params: { integrationAccountId: this.integrationAccountId },
          headers: {
            'X-Idempotency-Key': event.event_id,
          },
        });
      } catch (networkError) {
        lastError = networkError;
        if (attempt < this.maxAttempts) {
          await sleep(this.initialBackoffMs * 2 ** (attempt - 1));
        }
        continue;
      }

      if (response.status >= 200 && response.status < 300) {
        return;
      }

      if (response.status >= 400 && response.status < 500) {
        if (response.status === 401 || response.status === 403) {
          throw new Error(
            `Forwarder rejected (${response.status}): verify CORE_INTEGRATION_ACCOUNT_ID matches a connected Discord account`,
          );
        }
        throw new Error(
          `Forwarder rejected with ${response.status}: ${JSON.stringify(response.data)}`,
        );
      }

      lastError = new Error(`Forwarder ${response.status}: ${JSON.stringify(response.data)}`);
      if (attempt < this.maxAttempts) {
        await sleep(this.initialBackoffMs * 2 ** (attempt - 1));
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
