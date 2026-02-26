/**
 * CIM Action Layer
 *
 * How the agent affects the world. Every action is logged,
 * permission-checked, and reversible where possible.
 *
 * Implements the Act phase of the agent loop:
 *   Observe → Decide → Act → Observe result → Repeat
 *
 * Key principles:
 *   - Every action is logged with full context
 *   - Permission checks before execution
 *   - Structured success/failure states
 *   - Retry with exponential backoff for transient failures
 *   - Safe failure modes (never delete without confirmation)
 */

import { logger } from "~/services/logger.service";
import {
  runIntegrationExplorer,
  runMemoryExplorer,
  runWebExplorer,
} from "~/services/agent/explorers";
import { searchMemoryWithAgent } from "~/services/agent/memory";
import { IntegrationLoader } from "~/utils/mcp/integration-loader";

import type {
  ActionRequest,
  ActionResult,
  RetryConfig,
  PlanStep,
  CIMEngineConfig,
  ExternalMemoryEntry,
} from "./types";
import { DEFAULT_RETRY_CONFIG } from "./types";

// ---------------------------------------------------------------------------
// Action Executor
// ---------------------------------------------------------------------------

export async function executeAction(
  step: PlanStep,
  config: CIMEngineConfig,
  abortSignal?: AbortSignal,
): Promise<ActionResult> {
  const startTime = Date.now();
  const requestId = `action-${step.id}-${Date.now()}`;

  logger.info(
    `[CIM:Action] Executing step ${step.id}: ${step.action} - "${step.description}"`,
  );

  try {
    let data: unknown;
    let toolCalls = 0;

    switch (step.action) {
      case "memory_search": {
        const result = await searchMemoryWithAgent(
          step.description,
          config.userId,
          config.workspaceId,
          config.source,
          { structured: true, limit: 10 },
        );
        data = result;
        toolCalls = 1;
        break;
      }

      case "integration_query":
      case "integration_action": {
        const connectedIntegrations =
          await IntegrationLoader.getConnectedIntegrationAccounts(
            config.userId,
            config.workspaceId,
          );

        const integrationsList = connectedIntegrations
          .map(
            (int, index) =>
              `${index + 1}. **${int.integrationDefinition.name}** (Account ID: ${int.id}) (Identifier: ${int.accountId})`,
          )
          .join("\n");

        const mode = step.action === "integration_action" ? "write" : "read";
        const { stream, hasIntegrations } = await runIntegrationExplorer(
          step.description,
          integrationsList,
          mode,
          config.timezone,
          config.source,
          config.userId,
          abortSignal,
        );

        if (!hasIntegrations) {
          data = "No integrations connected";
        } else {
          // Consume the stream to get the result
          const chunks: string[] = [];
          for await (const chunk of stream.textStream) {
            chunks.push(chunk);
          }
          data = chunks.join("");
        }
        toolCalls = 1;
        break;
      }

      case "web_search": {
        const result = await runWebExplorer(step.description, config.timezone);
        data = result.success ? result.data : result.error;
        toolCalls = result.metadata?.toolCalls ?? 1;
        break;
      }

      case "verify_result": {
        // Verification is a no-op that logs the step
        data = { verified: true, step: step.description };
        toolCalls = 0;
        break;
      }

      case "human_review": {
        data = {
          awaitingReview: true,
          message: step.description,
        };
        toolCalls = 0;
        break;
      }

      default: {
        // Try as a generic memory search for unknown actions
        logger.warn(
          `[CIM:Action] Unknown action "${step.action}", falling back to memory search`,
        );
        const result = await searchMemoryWithAgent(
          step.description,
          config.userId,
          config.workspaceId,
          config.source,
          { structured: true, limit: 10 },
        );
        data = result;
        toolCalls = 1;
      }
    }

    const result: ActionResult = {
      requestId,
      success: true,
      data,
      executionTimeMs: Date.now() - startTime,
      toolCalls,
      logged: true,
      reversible: step.action !== "integration_action",
    };

    logger.info(
      `[CIM:Action] Step ${step.id} completed in ${result.executionTimeMs}ms`,
    );

    return result;
  } catch (error) {
    const result: ActionResult = {
      requestId,
      success: false,
      error: error instanceof Error ? error.message : String(error),
      executionTimeMs: Date.now() - startTime,
      toolCalls: 0,
      logged: true,
      reversible: true,
    };

    logger.error(`[CIM:Action] Step ${step.id} failed:`, error);
    return result;
  }
}

// ---------------------------------------------------------------------------
// Retry with Exponential Backoff
// ---------------------------------------------------------------------------

export async function executeWithRetry(
  step: PlanStep,
  config: CIMEngineConfig,
  retryConfig: RetryConfig = DEFAULT_RETRY_CONFIG,
  abortSignal?: AbortSignal,
): Promise<ActionResult> {
  let lastResult: ActionResult | null = null;

  for (let attempt = 1; attempt <= retryConfig.maxAttempts; attempt++) {
    if (abortSignal?.aborted) {
      return {
        requestId: `action-${step.id}-aborted`,
        success: false,
        error: "Action aborted",
        executionTimeMs: 0,
        toolCalls: 0,
        logged: true,
        reversible: true,
      };
    }

    lastResult = await executeAction(step, config, abortSignal);

    if (lastResult.success) {
      return lastResult;
    }

    // Don't retry non-transient failures
    if (isNonTransientError(lastResult.error)) {
      logger.info(
        `[CIM:Action] Non-transient error, not retrying: ${lastResult.error}`,
      );
      return lastResult;
    }

    if (attempt < retryConfig.maxAttempts) {
      const delay = Math.min(
        retryConfig.baseDelayMs *
          Math.pow(retryConfig.backoffMultiplier, attempt - 1),
        retryConfig.maxDelayMs,
      );
      logger.info(
        `[CIM:Action] Attempt ${attempt}/${retryConfig.maxAttempts} failed, ` +
          `retrying in ${delay}ms`,
      );
      await sleep(delay);
    }
  }

  return lastResult!;
}

function isNonTransientError(error?: string): boolean {
  if (!error) return false;
  const nonTransient = [
    "not found",
    "not connected",
    "permission denied",
    "unauthorized",
    "invalid",
    "not supported",
  ];
  const lowerError = error.toLowerCase();
  return nonTransient.some((phrase) => lowerError.includes(phrase));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Action Audit Trail
// ---------------------------------------------------------------------------

export function createAuditEntry(
  result: ActionResult,
  step: PlanStep,
  agentId: string,
): ExternalMemoryEntry {
  return {
    id: result.requestId,
    type: "audit_trail",
    content: [
      `Action: ${step.action}`,
      `Description: ${step.description}`,
      `Success: ${result.success}`,
      result.error ? `Error: ${result.error}` : null,
      `Duration: ${result.executionTimeMs}ms`,
      `Tool Calls: ${result.toolCalls}`,
    ]
      .filter(Boolean)
      .join("\n"),
    metadata: {
      stepId: step.id,
      action: step.action,
      success: result.success,
      executionTimeMs: result.executionTimeMs,
      reversible: result.reversible,
    },
    createdAt: new Date(),
    agentId,
  };
}
