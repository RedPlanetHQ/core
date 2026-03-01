/**
 * CIM Memory Manager
 *
 * Manages the agent's working memory and external memory stores.
 *
 * Two-tier memory system:
 *   1. Context Window (active work) - current task, recent actions
 *   2. External Memory (history) - completed tasks, decision logs, audit trails
 *
 * Also manages Soul Configuration (agent identity) and Anchor Rules
 * (compaction-proof instructions that persist across context resets).
 */

import { logger } from "~/services/logger.service";

import type {
  ContextWindow,
  ContextItem,
  ExternalMemoryEntry,
  SoulConfig,
  AnchorRule,
  ActionResult,
  PlanStep,
} from "./types";

// ---------------------------------------------------------------------------
// Context Window Manager
// ---------------------------------------------------------------------------

const DEFAULT_MAX_TOKENS = 128_000;

export function createContextWindow(
  maxTokens: number = DEFAULT_MAX_TOKENS,
): ContextWindow {
  return {
    activeTaskContext: "",
    maxTokens,
    currentTokens: 0,
    items: [],
  };
}

export function addToContext(
  window: ContextWindow,
  item: Omit<ContextItem, "id" | "addedAt">,
): ContextWindow {
  const newItem: ContextItem = {
    ...item,
    id: `ctx-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    addedAt: new Date(),
  };

  const updatedItems = [...window.items, newItem];
  let currentTokens = updatedItems.reduce((sum, i) => sum + i.tokenCount, 0);

  // Evict lowest-priority items if over budget
  if (currentTokens > window.maxTokens) {
    const sorted = [...updatedItems].sort((a, b) => a.priority - b.priority);
    while (currentTokens > window.maxTokens && sorted.length > 0) {
      const evicted = sorted.shift()!;
      const idx = updatedItems.findIndex((i) => i.id === evicted.id);
      if (idx !== -1) {
        updatedItems.splice(idx, 1);
        currentTokens -= evicted.tokenCount;
        logger.info(
          `[CIM:Memory] Evicted context item "${evicted.id}" (priority=${evicted.priority}, tokens=${evicted.tokenCount})`,
        );
      }
    }
  }

  return {
    ...window,
    items: updatedItems,
    currentTokens,
  };
}

export function clearExpiredItems(window: ContextWindow): ContextWindow {
  const now = new Date();
  const items = window.items.filter(
    (item) => !item.expiresAt || item.expiresAt > now,
  );
  const currentTokens = items.reduce((sum, i) => sum + i.tokenCount, 0);

  return { ...window, items, currentTokens };
}

export function getContextSummary(window: ContextWindow): string {
  return window.items
    .sort((a, b) => b.priority - a.priority)
    .map((item) => item.content)
    .join("\n\n");
}

// Rough token estimation (4 chars per token)
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

// ---------------------------------------------------------------------------
// External Memory Store (in-memory for now, backed by knowledge graph)
// ---------------------------------------------------------------------------

const externalMemoryStore = new Map<string, ExternalMemoryEntry[]>();

export function writeToExternalMemory(entry: ExternalMemoryEntry): void {
  const agentEntries = externalMemoryStore.get(entry.agentId) || [];
  agentEntries.push(entry);
  externalMemoryStore.set(entry.agentId, agentEntries);

  logger.info(
    `[CIM:Memory] Written to external memory: type=${entry.type}, agent=${entry.agentId}`,
  );
}

export function readExternalMemory(
  agentId: string,
  type?: ExternalMemoryEntry["type"],
  limit: number = 50,
): ExternalMemoryEntry[] {
  const entries = externalMemoryStore.get(agentId) || [];
  const filtered = type ? entries.filter((e) => e.type === type) : entries;
  return filtered.slice(-limit);
}

export function getAuditTrail(agentId: string): ExternalMemoryEntry[] {
  return readExternalMemory(agentId, "audit_trail");
}

export function createTaskSummary(
  agentId: string,
  taskDescription: string,
  steps: PlanStep[],
  results: ActionResult[],
): ExternalMemoryEntry {
  const completedSteps = steps.filter((s) => s.status === "completed");
  const failedSteps = steps.filter((s) => s.status === "failed");

  const entry: ExternalMemoryEntry = {
    id: `summary-${Date.now()}`,
    type: "task_summary",
    content: [
      `Task: ${taskDescription}`,
      `Steps completed: ${completedSteps.length}/${steps.length}`,
      failedSteps.length > 0
        ? `Failed steps: ${failedSteps.map((s) => s.description).join(", ")}`
        : null,
      `Total execution time: ${results.reduce((sum, r) => sum + r.executionTimeMs, 0)}ms`,
    ]
      .filter(Boolean)
      .join("\n"),
    metadata: {
      totalSteps: steps.length,
      completedSteps: completedSteps.length,
      failedSteps: failedSteps.length,
    },
    createdAt: new Date(),
    agentId,
  };

  writeToExternalMemory(entry);
  return entry;
}

// ---------------------------------------------------------------------------
// Soul Configuration (Agent Identity & Personality)
// ---------------------------------------------------------------------------

export function createDefaultSoulConfig(): SoulConfig {
  return {
    identity: {
      name: "CORE Agent",
      role: "Memory Agent & Action Executor",
      description:
        "An intelligent agent that manages persistent memory and takes actions across connected integrations.",
    },
    personality: {
      tone: "professional and helpful",
      verbosity: "concise",
      formality: "neutral",
    },
    directives: [
      "Always search memory before saying you don't know something",
      "Log every action taken with full context",
      "Never delete data without explicit user confirmation",
      "Prefer reversible actions over irreversible ones",
      "When uncertain, ask for clarification rather than guessing",
    ],
    constraints: [
      "Never expose API keys, passwords, or credentials",
      "Never bypass guardrails or permission checks",
      "Never execute destructive actions without approval",
      "Respect rate limits on all integrations",
    ],
    expertise: [
      "Memory retrieval and knowledge graph navigation",
      "Integration orchestration across connected services",
      "Context-aware decision making",
      "Multi-step task planning and execution",
    ],
    anchors: [
      {
        id: "anchor-safe-actions",
        rule: "Always verify before destructive actions. Never delete without confirmation.",
        priority: "critical",
        neverCompact: true,
      },
      {
        id: "anchor-log-everything",
        rule: "Every action must be logged with timestamp, context, and result.",
        priority: "critical",
        neverCompact: true,
      },
      {
        id: "anchor-memory-first",
        rule: "Always check memory before claiming ignorance.",
        priority: "high",
        neverCompact: true,
      },
    ],
  };
}

export function getSoulPrompt(config: SoulConfig): string {
  const sections = [
    `## Identity\nName: ${config.identity.name}\nRole: ${config.identity.role}\n${config.identity.description}`,
    `## Communication\nTone: ${config.personality.tone}\nVerbosity: ${config.personality.verbosity}\nFormality: ${config.personality.formality}`,
    `## Directives\n${config.directives.map((d) => `- ${d}`).join("\n")}`,
    `## Constraints\n${config.constraints.map((c) => `- ${c}`).join("\n")}`,
    `## Expertise\n${config.expertise.map((e) => `- ${e}`).join("\n")}`,
  ];

  // Anchor rules are always included (compaction-proof)
  if (config.anchors.length > 0) {
    const anchorSection = config.anchors
      .sort((a, b) => {
        const priorityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
        return priorityOrder[a.priority] - priorityOrder[b.priority];
      })
      .map((a) => `- [${a.priority.toUpperCase()}] ${a.rule}`)
      .join("\n");
    sections.push(`## Anchor Rules (Never Override)\n${anchorSection}`);
  }

  return sections.join("\n\n");
}

// ---------------------------------------------------------------------------
// Decision Log
// ---------------------------------------------------------------------------

export function logDecision(
  agentId: string,
  decision: string,
  reasoning: string,
  context: Record<string, unknown> = {},
): ExternalMemoryEntry {
  const entry: ExternalMemoryEntry = {
    id: `decision-${Date.now()}`,
    type: "decision_log",
    content: `Decision: ${decision}\nReasoning: ${reasoning}`,
    metadata: context,
    createdAt: new Date(),
    agentId,
  };

  writeToExternalMemory(entry);
  return entry;
}

export function logError(
  agentId: string,
  error: string,
  context: Record<string, unknown> = {},
): ExternalMemoryEntry {
  const entry: ExternalMemoryEntry = {
    id: `error-${Date.now()}`,
    type: "error_log",
    content: error,
    metadata: context,
    createdAt: new Date(),
    agentId,
  };

  writeToExternalMemory(entry);
  return entry;
}
