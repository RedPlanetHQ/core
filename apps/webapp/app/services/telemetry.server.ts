import { PostHog } from "posthog-node";
import { env } from "~/env.server";
import { prisma } from "~/db.server";

// Server-side PostHog client for backend tracking
let posthogClient: PostHog | null = null;

function getPostHogClient(): PostHog | null {
  if (!env.TELEMETRY_ENABLED || !env.POSTHOG_PROJECT_KEY) {
    return null;
  }

  if (!posthogClient) {
    posthogClient = new PostHog(env.POSTHOG_PROJECT_KEY, {
      host: "https://us.posthog.com",
    });
  }

  return posthogClient;
}

/**
 * Get user email from userId, or return "anonymous" if TELEMETRY_ANONYMOUS is enabled
 */
async function getUserIdentifier(userId?: string): Promise<string> {
  if (env.TELEMETRY_ANONYMOUS || !userId) {
    return "anonymous";
  }

  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { email: true },
    });
    return user?.email || "anonymous";
  } catch (error) {
    return "anonymous";
  }
}

// Telemetry event types
export type TelemetryEvent =
  | "episode_ingested"
  | "document_ingested"
  | "search_performed"
  | "deep_search_performed"
  | "conversation_created"
  | "conversation_message_sent"
  | "space_created"
  | "space_updated"
  | "user_registered"
  | "error_occurred"
  | "queue_job_started"
  | "queue_job_completed"
  | "queue_job_failed";

// Common properties for all events
interface BaseEventProperties {
  userId?: string;
  workspaceId?: string;
  email?: string;
  name?: string;
  queueProvider?: "trigger" | "bullmq";
  modelProvider?: string;
  embeddingModel?: string;
  appEnv?: string;
}

// Event-specific properties
interface EpisodeIngestedProperties extends BaseEventProperties {
  spaceId?: string;
  documentCount?: number;
  processingTimeMs?: number;
}

interface SearchPerformedProperties extends BaseEventProperties {
  query: string;
  resultsCount: number;
  searchType: "basic" | "deep";
  spaceIds?: string[];
}

interface ConversationProperties extends BaseEventProperties {
  conversationId: string;
  messageLength?: number;
  model?: string;
}

interface ErrorProperties extends BaseEventProperties {
  errorType: string;
  errorMessage: string;
  stackTrace?: string;
  context?: Record<string, any>;
}

interface QueueJobProperties extends BaseEventProperties {
  jobId: string;
  jobType: string;
  queueName: string;
  durationMs?: number;
}

type EventProperties =
  | EpisodeIngestedProperties
  | SearchPerformedProperties
  | ConversationProperties
  | ErrorProperties
  | QueueJobProperties
  | BaseEventProperties;

/**
 * Track telemetry events to PostHog
 */
export async function trackEvent(
  event: TelemetryEvent,
  properties: EventProperties,
): Promise<void> {
  const client = getPostHogClient();
  if (!client) return;

  try {
    const userId = properties.userId || "anonymous";

    // Add common properties to all events
    const enrichedProperties = {
      ...properties,
      queueProvider: env.QUEUE_PROVIDER,
      modelProvider: getModelProvider(),
      embeddingModel: env.EMBEDDING_MODEL,
      appEnv: env.APP_ENV,
      timestamp: new Date().toISOString(),
    };

    client.capture({
      distinctId: userId,
      event,
      properties: enrichedProperties,
    });

    // Identify user if we have their info
    if (properties.email || properties.name) {
      client.identify({
        distinctId: userId,
        properties: {
          email: properties.email,
          name: properties.name,
        },
      });
    }
  } catch (error) {
    // Silently fail - don't break the app if telemetry fails
    console.error("Telemetry error:", error);
  }
}

/**
 * Track feature usage - simplified API
 * @param feature - Feature name (e.g., "episode_ingested", "search_performed")
 * @param userId - User ID (will be converted to email internally)
 * @param properties - Additional properties (optional)
 */
export async function trackFeatureUsage(
  feature: string,
  userId?: string,
  properties?: Record<string, any>,
): Promise<void> {
  const client = getPostHogClient();
  if (!client) return;

  try {
    const email = await getUserIdentifier(userId);

    client.capture({
      distinctId: email,
      event: feature,
      properties: {
        ...properties,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    // Silently fail - don't break the app if telemetry fails
    console.error("Telemetry error:", error);
  }
}

/**
 * Track system configuration once at startup
 * Tracks queue provider, model provider, embedding model, etc.
 */
export async function trackConfig(): Promise<void> {
  const client = getPostHogClient();
  if (!client) return;

  try {
    client.capture({
      distinctId: "system",
      event: "system_config",
      properties: {
        queueProvider: env.QUEUE_PROVIDER,
        modelProvider: getModelProvider(),
        model: env.MODEL,
        embeddingModel: env.EMBEDDING_MODEL,
        appEnv: env.APP_ENV,
        nodeEnv: env.NODE_ENV,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error("Failed to track config:", error);
  }
}

/**
 * Track errors
 */
export async function trackError(
  error: Error,
  context?: Record<string, any>,
  userId?: string,
): Promise<void> {
  const client = getPostHogClient();
  if (!client) return;

  try {
    const email = await getUserIdentifier(userId);

    client.capture({
      distinctId: email,
      event: "error_occurred",
      properties: {
        errorType: error.name,
        errorMessage: error.message,
        stackTrace: error.stack,
        ...context,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (trackingError) {
    console.error("Failed to track error:", trackingError);
  }
}

/**
 * Flush pending events (call on shutdown)
 */
export async function flushTelemetry(): Promise<void> {
  const client = getPostHogClient();
  if (client) {
    await client.shutdown();
  }
}

/**
 * Helper to determine model provider from MODEL env variable
 */
function getModelProvider(): string {
  const model = env.MODEL.toLowerCase();
  if (model.includes("gpt") || model.includes("openai")) return "openai";
  if (model.includes("claude") || model.includes("anthropic"))
    return "anthropic";
  if (env.OLLAMA_URL) return "ollama";
  return "unknown";
}

// Export types for use in other files
export type {
  BaseEventProperties,
  EpisodeIngestedProperties,
  SearchPerformedProperties,
  ConversationProperties,
  ErrorProperties,
  QueueJobProperties,
};
