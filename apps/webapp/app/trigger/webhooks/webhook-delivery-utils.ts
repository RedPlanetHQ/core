import { logger } from "~/services/logger.service";
import crypto from "crypto";

// Common webhook delivery types
export type WebhookEventType =
  | "activity.created"
  | "integration.connected"
  | "integration.disconnected"
  | "mcp.connected"
  | "mcp.disconnected";

// Webhook target configuration
export interface WebhookTarget {
  url: string;
  secret?: string | null;
  headers?: Record<string, string>;
  accountId?: string;
}

// Delivery result
export interface DeliveryResult {
  url: string;
  status: number;
  success: boolean;
  responseBody?: string;
  error?: string;
}

// Generic webhook delivery parameters
export interface WebhookDeliveryParams {
  payload: any; // Can be any webhook payload structure
  targets: WebhookTarget[];
  userAgent?: string;
  eventType: WebhookEventType;
}

/**
 * Common webhook delivery function that handles HTTP delivery logic
 */
export async function deliverWebhook(params: WebhookDeliveryParams): Promise<{
  success: boolean;
  deliveryResults: DeliveryResult[];
  summary: {
    total: number;
    successful: number;
    failed: number;
  };
}> {
  const {
    payload,
    targets,
    userAgent = "Core-Webhooks/1.0",
    eventType,
  } = params;
  const payloadString = JSON.stringify({
    ...payload,
    accountId: payload.accountId,
  });
  const deliveryResults: DeliveryResult[] = [];

  logger.debug(`Delivering ${eventType} webhook to ${targets.length} targets`);

  // Send webhook to each target
  for (const target of targets) {
    const deliveryId = crypto.randomUUID();

    try {
      // Prepare headers
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        "User-Agent": userAgent,
        "X-Webhook-Delivery": deliveryId,
        "X-Webhook-Event": eventType,
        ...target.headers,
      };

      // Add HMAC signature if secret is configured
      if (target.secret) {
        const signature = crypto
          .createHmac("sha256", target.secret)
          .update(payloadString)
          .digest("hex");

        // Use different header names for different webhook types
        if (eventType === "activity.created") {
          headers["X-Hub-Signature-256"] = `sha256=${signature}`;
        } else {
          headers["X-Webhook-Secret"] = signature;
        }
      }

      // Make the HTTP request
      const response = await fetch(target.url, {
        method: "POST",
        headers,
        body: payloadString,
        signal: AbortSignal.timeout(30000), // 30 second timeout
      });

      const responseBody = await response.text().catch(() => "");

      const result: DeliveryResult = {
        url: target.url,
        status: response.status,
        success: response.ok,
        responseBody: responseBody.slice(0, 500), // Limit response body length
        error: response.ok
          ? undefined
          : `HTTP ${response.status}: ${response.statusText}`,
      };

      deliveryResults.push(result);

      logger.debug(`Webhook delivered to ${target.url}:`, {
        status: response.status,
        event: eventType,
        success: response.ok,
      });
    } catch (error) {
      const result: DeliveryResult = {
        url: target.url,
        status: 0,
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };

      deliveryResults.push(result);

      logger.error(`Failed to deliver webhook to ${target.url}:`, {
        error,
        event: eventType,
      });
    }
  }

  const successfulDeliveries = deliveryResults.filter((r) => r.success).length;
  const totalDeliveries = deliveryResults.length;

  logger.log(
    `Webhook delivery completed: ${successfulDeliveries}/${totalDeliveries} successful`,
    {
      event: eventType,
    },
  );

  return {
    success: successfulDeliveries > 0,
    deliveryResults,
    summary: {
      total: totalDeliveries,
      successful: successfulDeliveries,
      failed: totalDeliveries - successfulDeliveries,
    },
  };
}

/**
 * Helper function to prepare webhook targets from basic URL/secret pairs
 */
export function prepareWebhookTargets(
  webhooks: Array<{ url: string; secret?: string | null; id: string }>,
): WebhookTarget[] {
  return webhooks.map((webhook) => ({
    url: webhook.url,
    secret: webhook.secret,
    accountId: webhook.id,
  }));
}
