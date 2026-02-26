/**
 * CIM Heartbeat System
 *
 * Periodic monitoring that runs in the background. Checks
 * connected integrations at configurable intervals and flags
 * anything that needs attention.
 *
 * Design principles:
 *   - Uses the cheapest model tier (background/low) for cost efficiency
 *   - Respects active hours (won't ping at 3am)
 *   - Rotates through checks to spread load
 *   - Each check is independent and can fail without affecting others
 */

import { logger } from "~/services/logger.service";

import type {
  HeartbeatConfig,
  HeartbeatCheck,
  HeartbeatResult,
  HeartbeatFinding,
  ModelTier,
} from "./types";

// ---------------------------------------------------------------------------
// Default Heartbeat Configuration
// ---------------------------------------------------------------------------

export function createDefaultHeartbeatConfig(
  timezone: string = "UTC",
): HeartbeatConfig {
  return {
    enabled: false,
    intervalMs: 30 * 60 * 1000, // 30 minutes
    checks: [
      {
        id: "check-email",
        type: "email",
        integration: "gmail",
        query: "Check for unread emails that need urgent response",
        priority: "high",
      },
      {
        id: "check-calendar",
        type: "calendar",
        integration: "google-calendar",
        query: "Check upcoming meetings in the next 2 hours",
        priority: "medium",
      },
      {
        id: "check-slack",
        type: "slack",
        integration: "slack",
        query: "Check for unread direct messages and mentions",
        priority: "high",
      },
      {
        id: "check-github",
        type: "github",
        integration: "github",
        query: "Check for new PR reviews requested and critical issue updates",
        priority: "medium",
      },
    ],
    activeHours: { start: 8, end: 22 }, // 8am to 10pm
    timezone,
    modelTier: "low",
  };
}

// ---------------------------------------------------------------------------
// Active Hours Check
// ---------------------------------------------------------------------------

export function isWithinActiveHours(config: HeartbeatConfig): boolean {
  const now = new Date();

  // Get current hour in the configured timezone
  const formatter = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    hour12: false,
    timeZone: config.timezone,
  });
  const currentHour = parseInt(formatter.format(now), 10);

  return (
    currentHour >= config.activeHours.start &&
    currentHour < config.activeHours.end
  );
}

// ---------------------------------------------------------------------------
// Heartbeat Runner
// ---------------------------------------------------------------------------

export async function runHeartbeatCheck(
  check: HeartbeatCheck,
  executeQuery: (
    integration: string,
    query: string,
  ) => Promise<string>,
): Promise<HeartbeatResult> {
  const startTime = Date.now();
  logger.info(
    `[CIM:Heartbeat] Running check: ${check.id} (${check.type})`,
  );

  const findings: HeartbeatFinding[] = [];

  try {
    if (!check.integration) {
      logger.warn(
        `[CIM:Heartbeat] Check ${check.id} has no integration, skipping`,
      );
      return {
        checkId: check.id,
        timestamp: new Date(),
        findings: [],
        nextScheduledRun: new Date(startTime + 30 * 60 * 1000),
      };
    }

    const result = await executeQuery(check.integration, check.query);

    // Parse the result into findings
    if (result && result !== "No integrations connected" && result.trim()) {
      findings.push({
        source: check.integration,
        summary: result,
        priority: check.priority,
        actionRequired: check.priority === "high",
        suggestedAction:
          check.priority === "high"
            ? `Review ${check.type} findings and respond if needed`
            : undefined,
      });
    }

    check.lastRun = new Date();
    check.lastResult = result;

    logger.info(
      `[CIM:Heartbeat] Check ${check.id} completed in ${Date.now() - startTime}ms, ` +
        `${findings.length} findings`,
    );
  } catch (error) {
    logger.error(`[CIM:Heartbeat] Check ${check.id} failed:`, error);
    findings.push({
      source: check.integration || check.type,
      summary: `Heartbeat check failed: ${error instanceof Error ? error.message : String(error)}`,
      priority: "low",
      actionRequired: false,
    });
  }

  return {
    checkId: check.id,
    timestamp: new Date(),
    findings,
    nextScheduledRun: new Date(Date.now() + 30 * 60 * 1000),
  };
}

export async function runHeartbeatCycle(
  config: HeartbeatConfig,
  executeQuery: (
    integration: string,
    query: string,
  ) => Promise<string>,
): Promise<HeartbeatResult[]> {
  if (!config.enabled) {
    logger.info("[CIM:Heartbeat] Heartbeat is disabled, skipping cycle");
    return [];
  }

  if (!isWithinActiveHours(config)) {
    logger.info(
      "[CIM:Heartbeat] Outside active hours, skipping cycle",
    );
    return [];
  }

  logger.info(
    `[CIM:Heartbeat] Starting heartbeat cycle with ${config.checks.length} checks`,
  );

  // Run checks in order of priority (high first)
  const sortedChecks = [...config.checks].sort((a, b) => {
    const priorityOrder = { high: 0, medium: 1, low: 2 };
    return priorityOrder[a.priority] - priorityOrder[b.priority];
  });

  const results: HeartbeatResult[] = [];

  for (const check of sortedChecks) {
    const result = await runHeartbeatCheck(check, executeQuery);
    results.push(result);
  }

  const totalFindings = results.reduce(
    (sum, r) => sum + r.findings.length,
    0,
  );
  const actionRequired = results.some((r) =>
    r.findings.some((f) => f.actionRequired),
  );

  logger.info(
    `[CIM:Heartbeat] Cycle complete. ` +
      `${totalFindings} total findings, action required: ${actionRequired}`,
  );

  return results;
}

// ---------------------------------------------------------------------------
// Heartbeat Summary (for user notification)
// ---------------------------------------------------------------------------

export function formatHeartbeatSummary(results: HeartbeatResult[]): string {
  const allFindings = results.flatMap((r) => r.findings);

  if (allFindings.length === 0) {
    return "All clear - no items requiring attention.";
  }

  const critical = allFindings.filter((f) => f.priority === "critical");
  const high = allFindings.filter((f) => f.priority === "high");
  const medium = allFindings.filter((f) => f.priority === "medium");
  const low = allFindings.filter((f) => f.priority === "low");

  const sections: string[] = [];

  if (critical.length > 0) {
    sections.push(
      `**CRITICAL** (${critical.length}):\n${critical.map((f) => `- [${f.source}] ${f.summary}`).join("\n")}`,
    );
  }
  if (high.length > 0) {
    sections.push(
      `**Needs Attention** (${high.length}):\n${high.map((f) => `- [${f.source}] ${f.summary}`).join("\n")}`,
    );
  }
  if (medium.length > 0) {
    sections.push(
      `**FYI** (${medium.length}):\n${medium.map((f) => `- [${f.source}] ${f.summary}`).join("\n")}`,
    );
  }
  if (low.length > 0) {
    sections.push(
      `**Low Priority** (${low.length}):\n${low.map((f) => `- [${f.source}] ${f.summary}`).join("\n")}`,
    );
  }

  return sections.join("\n\n");
}
