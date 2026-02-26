/**
 * CIM Engine - Cognitive Intelligence Module
 *
 * The top-level agent loop that ties Perception, Decision, and Action
 * layers together into a goal-driven execution cycle.
 *
 * Loop:
 *   1. PERCEIVE  - Observe the current state (memory, integrations, web)
 *   2. DECIDE    - Classify intent, create plan, select model
 *   3. ACT       - Execute plan steps with guardrails and retry
 *   4. OBSERVE   - Check results, update state
 *   5. REPEAT    - Until goal is met or stopping condition
 *
 * Integrates all CIM subsystems:
 *   - Perception layer for environment observation
 *   - Decision layer for planning and intent classification
 *   - Action layer for guarded execution with retry
 *   - Memory manager for context window and external memory
 *   - Guardrails for permission enforcement
 *   - Multi-agent support for team coordination
 *   - Heartbeat for background monitoring
 */

import { logger } from "~/services/logger.service";

import type {
  CIMEngineConfig,
  CIMLoopState,
  CIMResult,
  CIMError,
  Goal,
  Plan,
  PlanStep,
  ActionResult,
  ExternalMemoryEntry,
  PerceptionResult,
} from "./types";

import { perceive } from "./perception";
import { decide } from "./decision";
import { executeWithRetry } from "./action";
import { createAuditEntry } from "./action";
import { checkStepGuardrails } from "./guardrails";
import {
  createContextWindow,
  addToContext,
  writeToExternalMemory,
  createTaskSummary,
  logDecision,
  logError,
  estimateTokens,
} from "./memory-manager";

// ---------------------------------------------------------------------------
// Goal Construction
// ---------------------------------------------------------------------------

export function createGoal(
  description: string,
  options: {
    successCriteria?: string[];
    priority?: number;
    deadline?: Date;
    parentGoalId?: string;
  } = {},
): Goal {
  return {
    id: `goal-${Date.now()}`,
    description,
    successCriteria: options.successCriteria || [
      "The requested information or action is provided",
    ],
    priority: options.priority ?? 5,
    deadline: options.deadline,
    parentGoalId: options.parentGoalId,
  };
}

// ---------------------------------------------------------------------------
// CIM Engine - Main Loop
// ---------------------------------------------------------------------------

export async function runCIMLoop(
  query: string,
  config: CIMEngineConfig,
  abortSignal?: AbortSignal,
): Promise<CIMResult> {
  const agentId = `cim-${config.userId}-${Date.now()}`;
  const startTime = Date.now();

  logger.info(
    `[CIM:Engine] Starting CIM loop for: "${query}" (agent: ${agentId})`,
  );

  // Initialize loop state
  const goal = createGoal(query);
  const contextWindow = createContextWindow();
  const auditTrail: ExternalMemoryEntry[] = [];
  const errors: CIMError[] = [];

  const state: CIMLoopState = {
    iteration: 0,
    status: "idle",
    goal,
    perception: {
      state: {
        timestamp: new Date(),
        sources: [],
        context: {},
        entities: [],
        summary: "",
      },
      relevantMemories: [],
      activeIntegrations: [],
      pendingEvents: [],
    },
    actionHistory: [],
    errors,
    startedAt: new Date(),
  };

  try {
    // -----------------------------------------------------------------------
    // Phase 1: PERCEIVE
    // -----------------------------------------------------------------------
    state.status = "perceiving";
    state.iteration = 1;

    logger.info(`[CIM:Engine] Phase 1: PERCEIVE`);

    let perception: PerceptionResult;
    try {
      perception = await perceive(config, query);
      state.perception = perception;

      // Add perception results to context window
      addToContext(contextWindow, {
        content: `Perception: ${perception.state.summary}`,
        tokenCount: estimateTokens(perception.state.summary),
        priority: 8,
        source: "perception",
      });

      if (perception.relevantMemories.length > 0) {
        const memoryContent = perception.relevantMemories
          .slice(0, 5)
          .map((m) => m.content)
          .join("\n---\n");
        addToContext(contextWindow, {
          content: `Relevant memories:\n${memoryContent}`,
          tokenCount: estimateTokens(memoryContent),
          priority: 7,
          source: "memory",
        });
      }
    } catch (error) {
      const cimError: CIMError = {
        phase: "perception",
        message:
          error instanceof Error ? error.message : String(error),
        recoverable: true,
        timestamp: new Date(),
      };
      errors.push(cimError);
      logError(agentId, cimError.message, { phase: "perception" });
      logger.warn(`[CIM:Engine] Perception failed, continuing with defaults`);

      perception = state.perception;
    }

    // -----------------------------------------------------------------------
    // Phase 2: DECIDE (Plan)
    // -----------------------------------------------------------------------
    state.status = "planning";

    logger.info(`[CIM:Engine] Phase 2: DECIDE`);

    let plan: Plan;
    try {
      const decision = await decide(query, goal, perception, config);
      plan = decision.plan;
      state.plan = plan;

      logDecision(agentId, `Plan created: ${plan.steps.length} steps`, decision.reasoning, {
        intent: decision.intent,
        modelTier: decision.selectedModel,
      });

      logger.info(
        `[CIM:Engine] Plan: ${plan.steps.length} steps, ` +
          `complexity=${plan.estimatedComplexity}, ` +
          `approval=${plan.requiresApproval}`,
      );
    } catch (error) {
      const cimError: CIMError = {
        phase: "planning",
        message:
          error instanceof Error ? error.message : String(error),
        recoverable: true,
        timestamp: new Date(),
      };
      errors.push(cimError);
      logError(agentId, cimError.message, { phase: "planning" });

      // Fallback: single memory search step
      plan = {
        id: `plan-fallback-${Date.now()}`,
        goalId: goal.id,
        steps: [
          {
            id: "step-1",
            order: 1,
            description: query,
            action: "memory_search",
            dependencies: [],
            status: "pending",
          },
        ],
        estimatedComplexity: "simple",
        requiresApproval: false,
        createdAt: new Date(),
      };
      state.plan = plan;
    }

    // -----------------------------------------------------------------------
    // Phase 3: ACT (Execute Plan)
    // -----------------------------------------------------------------------
    state.status = "acting";

    logger.info(`[CIM:Engine] Phase 3: ACT`);

    // Check if plan needs human approval
    if (plan.requiresApproval) {
      state.status = "waiting_human";
      logger.info(`[CIM:Engine] Plan requires human approval, pausing`);

      return {
        success: true,
        goalMet: false,
        finalState: state,
        summary: `Plan created with ${plan.steps.length} steps but requires human approval before execution.`,
        auditTrail,
      };
    }

    // Execute plan steps in dependency order
    for (const step of plan.steps) {
      if (abortSignal?.aborted) {
        step.status = "skipped";
        logger.info(`[CIM:Engine] Aborted, skipping step ${step.id}`);
        continue;
      }

      // Check dependencies
      const depsCompleted = step.dependencies.every((depId) => {
        const depStep = plan.steps.find((s) => s.id === depId);
        return depStep?.status === "completed";
      });

      if (!depsCompleted) {
        step.status = "skipped";
        logger.info(
          `[CIM:Engine] Skipping step ${step.id}: dependencies not met`,
        );
        continue;
      }

      // Check guardrails
      const guardrailCheck = checkStepGuardrails(
        step,
        config,
        config.guardrails,
      );

      if (!guardrailCheck.canExecute) {
        step.status = "failed";
        step.result = {
          requestId: step.id,
          success: false,
          error: `Blocked by guardrails: ${guardrailCheck.blockedReasons.join(", ")}`,
          executionTimeMs: 0,
          toolCalls: 0,
          logged: true,
          reversible: true,
        };
        logger.warn(
          `[CIM:Engine] Step ${step.id} blocked by guardrails`,
        );
        continue;
      }

      if (guardrailCheck.needsApproval) {
        state.status = "waiting_human";
        logger.info(
          `[CIM:Engine] Step ${step.id} requires approval, pausing`,
        );
        break;
      }

      // Execute step with retry
      step.status = "in_progress";
      state.status = "acting";

      const result = await executeWithRetry(
        step,
        config,
        undefined,
        abortSignal,
      );

      step.result = result;
      step.status = result.success ? "completed" : "failed";
      state.actionHistory.push(result);

      // Log to audit trail
      const auditEntry = createAuditEntry(result, step, agentId);
      auditTrail.push(auditEntry);
      writeToExternalMemory(auditEntry);

      if (!result.success) {
        const cimError: CIMError = {
          phase: "action",
          message: result.error || "Unknown action error",
          recoverable: false,
          timestamp: new Date(),
          context: { stepId: step.id, action: step.action },
        };
        errors.push(cimError);
        logError(agentId, cimError.message, {
          phase: "action",
          step: step.id,
        });
      }

      // Iteration tracking
      state.iteration++;
      if (state.iteration >= config.maxLoopIterations) {
        logger.info(
          `[CIM:Engine] Max iterations (${config.maxLoopIterations}) reached`,
        );
        break;
      }
    }

    // -----------------------------------------------------------------------
    // Phase 4: OBSERVE (Check Results)
    // -----------------------------------------------------------------------
    logger.info(`[CIM:Engine] Phase 4: OBSERVE results`);

    const completedSteps = plan.steps.filter(
      (s) => s.status === "completed",
    );
    const failedSteps = plan.steps.filter((s) => s.status === "failed");
    const goalMet = completedSteps.length > 0 && failedSteps.length === 0;

    // Create task summary for external memory
    createTaskSummary(
      agentId,
      query,
      plan.steps,
      state.actionHistory,
    );

    state.status = goalMet ? "completed" : "failed";
    state.completedAt = new Date();

    const totalTimeMs = Date.now() - startTime;

    // Build result summary
    const resultData = state.actionHistory
      .filter((r) => r.success && r.data)
      .map((r) => {
        if (typeof r.data === "string") return r.data;
        if (typeof r.data === "object" && r.data !== null) {
          const obj = r.data as Record<string, unknown>;
          if ("episodes" in obj || "content" in obj) {
            return JSON.stringify(r.data);
          }
        }
        return String(r.data);
      })
      .join("\n\n");

    const summary = [
      `Goal: ${query}`,
      `Status: ${state.status}`,
      `Steps: ${completedSteps.length}/${plan.steps.length} completed`,
      failedSteps.length > 0
        ? `Failed: ${failedSteps.map((s) => s.description).join(", ")}`
        : null,
      `Errors: ${errors.length}`,
      `Duration: ${totalTimeMs}ms`,
      resultData ? `\nResults:\n${resultData}` : null,
    ]
      .filter(Boolean)
      .join("\n");

    logger.info(
      `[CIM:Engine] Loop complete. ` +
        `${completedSteps.length}/${plan.steps.length} steps, ` +
        `${errors.length} errors, ${totalTimeMs}ms`,
    );

    return {
      success: goalMet,
      goalMet,
      finalState: state,
      summary,
      auditTrail,
    };
  } catch (error) {
    // Top-level catch for catastrophic failures
    state.status = "failed";
    state.completedAt = new Date();

    const errorMessage =
      error instanceof Error ? error.message : String(error);
    logError(agentId, `Catastrophic failure: ${errorMessage}`, {
      phase: "engine",
    });

    logger.error(`[CIM:Engine] Catastrophic failure:`, error);

    return {
      success: false,
      goalMet: false,
      finalState: state,
      summary: `CIM engine failed: ${errorMessage}`,
      auditTrail,
    };
  }
}

// ---------------------------------------------------------------------------
// Convenience: Run a simple CIM query
// ---------------------------------------------------------------------------

export async function runCIM(
  query: string,
  userId: string,
  workspaceId: string,
  options: {
    timezone?: string;
    source?: string;
    maxIterations?: number;
  } = {},
): Promise<CIMResult> {
  const config: CIMEngineConfig = {
    userId,
    workspaceId,
    timezone: options.timezone || "UTC",
    source: options.source || "cim-engine",
    maxLoopIterations: options.maxIterations || 10,
    modelTier: "high",
  };

  return runCIMLoop(query, config);
}
