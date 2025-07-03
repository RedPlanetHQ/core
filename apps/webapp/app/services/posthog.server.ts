import { env } from "~/env.server";
import { logger } from "./logger.service";
import fetch from "node-fetch";

interface PostHogEvent {
  event: string;
  distinctId: string;
  properties?: Record<string, any>;
  timestamp?: string;
}

/**
 * Server-side PostHog client for analytics tracking
 * Provides methods to track events on the server without requiring the client-side JS
 */
export class PostHogService {
  private readonly apiKey: string;
  private readonly host: string;
  private readonly enabled: boolean;

  constructor() {
    this.apiKey = env.POSTHOG_PROJECT_KEY;
    this.host = "https://eu.posthog.com";
    this.enabled = !!this.apiKey && this.apiKey.length > 0;
    
    if (!this.enabled) {
      logger.warn("PostHog tracking is disabled. Set POSTHOG_PROJECT_KEY to enable.");
    }
  }

  /**
   * Capture an event in PostHog
   * @param event Event name
   * @param distinctId User ID for identification
   * @param properties Additional properties to track
   * @returns Promise resolving to true if successful
   */
  public async capture(
    event: string,
    distinctId: string,
    properties: Record<string, any> = {}
  ): Promise<boolean> {
    if (!this.enabled) return false;
    if (!distinctId) {
      logger.warn("PostHog event capture failed: No distinctId provided");
      return false;
    }

    try {
      const eventData: PostHogEvent = {
        event,
        distinctId,
        properties: {
          ...properties,
          $lib: "server",
          $lib_version: "1.0.0",
        },
        timestamp: new Date().toISOString(),
      };

      const response = await fetch(`${this.host}/capture/`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          api_key: this.apiKey,
          batch: [eventData],
        }),
      });

      if (!response.ok) {
        logger.error(`PostHog capture failed: ${response.status} ${response.statusText}`);
        return false;
      }

      logger.debug(`PostHog event captured: ${event}`, { 
        distinctId, 
        eventName: event
      });
      return true;
    } catch (error) {
      logger.error("Error sending event to PostHog", { error });
      return false;
    }
  }

  /**
   * Track search event in PostHog
   * @param userId User ID
   * @param query Search query
   * @param options Search options
   * @param resultCounts Result counts
   * @returns Promise resolving to true if successful
   */
  public async trackSearch(
    userId: string,
    query: string,
    options: Record<string, any> = {},
    resultCounts: Record<string, number> = {}
  ): Promise<boolean> {
    return this.capture("search", userId, {
      query,
      query_length: query.length,
      ...options,
      ...resultCounts,
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Track ingestion event in PostHog
   * @param userId User ID
   * @param episodeLength Length of ingested content
   * @param metadata Additional metadata
   * @param success Whether ingestion succeeded
   * @returns Promise resolving to true if successful
   */
  public async trackIngestion(
    userId: string,
    episodeLength: number,
    metadata: Record<string, any> = {},
    success: boolean = true
  ): Promise<boolean> {
    return this.capture("ingestion", userId, {
      episode_length: episodeLength,
      success,
      ...metadata,
      timestamp: new Date().toISOString(),
    });
  }
}

// Singleton instance for use across the application
export const posthogService = new PostHogService();