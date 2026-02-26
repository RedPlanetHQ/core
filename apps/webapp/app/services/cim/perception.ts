/**
 * CIM Perception Layer
 *
 * How the agent sees the world. Gathers context from memory,
 * integrations, and external sources to build a complete
 * picture of the current state before any decision is made.
 *
 * Implements the Observe phase of the agent loop:
 *   Observe → Decide → Act → Observe result → Repeat
 */

import { logger } from "~/services/logger.service";
import { searchMemoryWithAgent } from "~/services/agent/memory";
import { IntegrationLoader } from "~/utils/mcp/integration-loader";

import type {
  PerceptionResult,
  PerceptionSource,
  PerceptionEvent,
  ObservedState,
  MemoryFragment,
  CIMEngineConfig,
} from "./types";

// ---------------------------------------------------------------------------
// State Observer - Observes the current environment
// ---------------------------------------------------------------------------

export async function observeState(
  config: CIMEngineConfig,
  query: string,
): Promise<ObservedState> {
  const startTime = Date.now();
  logger.info(`[CIM:Perception] Observing state for: "${query}"`);

  const sources: PerceptionSource[] = [];
  const entities: string[] = [];
  const context: Record<string, unknown> = {};

  // Gather connected integrations to understand what's available
  const connectedIntegrations =
    await IntegrationLoader.getConnectedIntegrationAccounts(
      config.userId,
      config.workspaceId,
    );

  const integrationNames = connectedIntegrations.map(
    (int) => int.integrationDefinition.name,
  );

  context.connectedIntegrations = integrationNames;
  context.timezone = config.timezone;
  context.source = config.source;
  context.observationTimeMs = Date.now() - startTime;

  sources.push({
    type: "integration",
    provider: "integration-loader",
    confidence: 1.0,
  });

  logger.info(
    `[CIM:Perception] State observed in ${Date.now() - startTime}ms, ` +
      `${integrationNames.length} integrations available`,
  );

  return {
    timestamp: new Date(),
    sources,
    context,
    entities,
    summary: `Environment: ${integrationNames.length} integrations connected (${integrationNames.join(", ")}). Source: ${config.source}. Timezone: ${config.timezone}.`,
  };
}

// ---------------------------------------------------------------------------
// Context Gatherer - Fetches relevant memories and data
// ---------------------------------------------------------------------------

export async function gatherContext(
  config: CIMEngineConfig,
  query: string,
  state: ObservedState,
): Promise<PerceptionResult> {
  const startTime = Date.now();
  logger.info(`[CIM:Perception] Gathering context for: "${query}"`);

  const relevantMemories: MemoryFragment[] = [];
  const pendingEvents: PerceptionEvent[] = [];
  const activeIntegrations = (
    (state.context.connectedIntegrations as string[]) || []
  );

  // Search memory for relevant context
  try {
    const memoryResult = await searchMemoryWithAgent(
      query,
      config.userId,
      config.workspaceId,
      config.source,
      { structured: true, limit: 10 },
    );

    const structured = memoryResult as {
      episodes?: Array<{
        uuid: string;
        content: string;
        relevanceScore?: number;
        createdAt: string;
      }>;
      facts?: Array<{
        factUuid: string;
        fact: string;
        aspect?: string;
        validAt: string;
      }>;
    };

    // Convert episodes to memory fragments
    if (structured.episodes) {
      for (const episode of structured.episodes) {
        relevantMemories.push({
          id: episode.uuid,
          content: episode.content,
          relevanceScore: episode.relevanceScore ?? 0,
          createdAt: new Date(episode.createdAt),
          source: "memory",
        });
      }
    }

    // Convert facts to memory fragments with aspect classification
    if (structured.facts) {
      for (const fact of structured.facts) {
        relevantMemories.push({
          id: fact.factUuid,
          content: fact.fact,
          aspect: fact.aspect,
          relevanceScore: 0.8,
          createdAt: new Date(fact.validAt),
          source: "knowledge-graph",
        });
      }
    }

    state.sources.push({
      type: "memory",
      provider: "memory-agent",
      confidence: relevantMemories.length > 0 ? 0.85 : 0.2,
    });
  } catch (error) {
    logger.warn(`[CIM:Perception] Memory search failed:`, error);
    state.sources.push({
      type: "memory",
      provider: "memory-agent",
      confidence: 0,
    });
  }

  logger.info(
    `[CIM:Perception] Context gathered in ${Date.now() - startTime}ms: ` +
      `${relevantMemories.length} memories, ${activeIntegrations.length} integrations`,
  );

  return {
    state,
    relevantMemories,
    activeIntegrations,
    pendingEvents,
  };
}

// ---------------------------------------------------------------------------
// Perception Pipeline - Full observe cycle
// ---------------------------------------------------------------------------

export async function perceive(
  config: CIMEngineConfig,
  query: string,
): Promise<PerceptionResult> {
  logger.info(`[CIM:Perception] Starting perception pipeline`);

  const state = await observeState(config, query);
  const result = await gatherContext(config, query, state);

  logger.info(
    `[CIM:Perception] Pipeline complete. ` +
      `Memories: ${result.relevantMemories.length}, ` +
      `Integrations: ${result.activeIntegrations.length}, ` +
      `Events: ${result.pendingEvents.length}`,
  );

  return result;
}
