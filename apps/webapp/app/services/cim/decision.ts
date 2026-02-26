/**
 * CIM Decision Layer
 *
 * How the agent chooses what to do. Classifies intent, creates
 * execution plans, and routes to appropriate handlers.
 *
 * Implements the Decide phase of the agent loop:
 *   Observe → Decide → Act → Observe result → Repeat
 *
 * Key principles:
 *   - Structured decision trees for routine cases
 *   - LLM invocation only for ambiguous situations
 *   - Planning before execution for non-trivial tasks
 *   - Goal decomposition into dependency-ordered steps
 */

import { generateObject } from "ai";
import { z } from "zod";

import { logger } from "~/services/logger.service";
import { getModel, getModelForTask } from "~/lib/model.server";

import type {
  IntentClassification,
  Plan,
  PlanStep,
  DecisionResult,
  PerceptionResult,
  Goal,
  ModelTier,
  CIMEngineConfig,
} from "./types";

// ---------------------------------------------------------------------------
// Intent Classifier
// ---------------------------------------------------------------------------

const INTENT_CLASSIFIER_PROMPT = `You are an intent classifier for a memory agent system.

Analyze the user's query and classify it precisely.

QUERY TYPES:
- "aspect": Asking about preferences, decisions, directives, goals, etc. (e.g., "What are my coding preferences?")
- "entity": Asking about a specific person, project, or thing (e.g., "Tell me about the auth service")
- "temporal": Asking about events in a time range (e.g., "What happened last week?")
- "exploratory": Open-ended catch-up (e.g., "What's new?", "Catch me up")
- "relationship": Asking how things connect (e.g., "How does service A relate to B?")

COMPLEXITY:
- "simple": Single source, direct answer (one search or one action)
- "moderate": Multiple sources or a few steps needed
- "complex": Multi-step plan, multiple integrations, or ambiguous goal

REQUIRED SOURCES:
- "memory": Past conversations, stored knowledge, decisions
- "integration": Live data from connected services
- "web": Real-time info from the internet
- "document": Stored documents
- "user_input": Needs clarification from the user

SUGGESTED TOOLS:
Choose from: memory_search, integration_query, web_search, integration_action, plan_and_execute`;

export async function classifyIntent(
  query: string,
  perception: PerceptionResult,
  config: CIMEngineConfig,
): Promise<IntentClassification> {
  const startTime = Date.now();
  logger.info(`[CIM:Decision] Classifying intent for: "${query}"`);

  try {
    const modelName = getModelForTask("low");
    const model = getModel(modelName);

    const contextSummary = [
      `Available integrations: ${perception.activeIntegrations.join(", ") || "none"}`,
      `Relevant memories: ${perception.relevantMemories.length}`,
      `Pending events: ${perception.pendingEvents.length}`,
    ].join("\n");

    const { object } = await generateObject({
      model,
      system: INTENT_CLASSIFIER_PROMPT,
      prompt: `Context:\n${contextSummary}\n\nUser Query: "${query}"\n\nClassify this query.`,
      schema: z.object({
        primaryIntent: z
          .string()
          .describe("A concise description of what the user wants"),
        confidence: z
          .number()
          .min(0)
          .max(1)
          .describe("Confidence in classification (0-1)"),
        queryType: z.enum([
          "aspect",
          "entity",
          "temporal",
          "exploratory",
          "relationship",
        ]),
        requiredSources: z.array(
          z.enum(["memory", "integration", "web", "document", "user_input"]),
        ),
        suggestedTools: z.array(z.string()),
        complexity: z.enum(["simple", "moderate", "complex"]),
      }),
      providerOptions: {
        openai: { strictJsonSchema: false },
      },
    });

    logger.info(
      `[CIM:Decision] Intent classified in ${Date.now() - startTime}ms: ` +
        `type=${object.queryType}, complexity=${object.complexity}, confidence=${object.confidence}`,
    );

    return object;
  } catch (error) {
    logger.error(`[CIM:Decision] Intent classification failed:`, error);

    // Fallback to exploratory with memory search
    return {
      primaryIntent: query,
      confidence: 0.3,
      queryType: "exploratory",
      requiredSources: ["memory"],
      suggestedTools: ["memory_search"],
      complexity: "simple",
    };
  }
}

// ---------------------------------------------------------------------------
// Planner - Breaks goals into executable steps
// ---------------------------------------------------------------------------

const PLANNER_PROMPT = `You are a planning agent that breaks goals into executable steps.

For each step, specify:
- A clear description of what to do
- The action/tool to use
- Dependencies on other steps (by step ID)

PLANNING PRINCIPLES:
1. Always start with information gathering before taking actions
2. Identify edge cases and dependencies
3. Include verification steps for critical actions
4. Plan for rollback where possible
5. Keep steps atomic - one action per step

AVAILABLE ACTIONS:
- memory_search: Search past conversations and knowledge
- integration_query: Query connected services for live data
- integration_action: Execute actions on connected services
- web_search: Search the web for information
- verify_result: Verify a previous step's result
- human_review: Request human review before proceeding

For simple queries (single search), create just 1-2 steps.
For complex goals, create up to 8 steps with proper ordering.`;

export async function createPlan(
  goal: Goal,
  intent: IntentClassification,
  perception: PerceptionResult,
  config: CIMEngineConfig,
): Promise<Plan> {
  const startTime = Date.now();
  logger.info(`[CIM:Decision] Creating plan for goal: "${goal.description}"`);

  // Simple queries don't need LLM planning
  if (intent.complexity === "simple") {
    const simplePlan = createSimplePlan(goal, intent);
    logger.info(
      `[CIM:Decision] Simple plan created in ${Date.now() - startTime}ms`,
    );
    return simplePlan;
  }

  try {
    const modelName = getModelForTask(
      intent.complexity === "complex" ? "high" : "low",
    );
    const model = getModel(modelName);

    const contextSummary = [
      `Goal: ${goal.description}`,
      `Success Criteria: ${goal.successCriteria.join(", ")}`,
      `Intent: ${intent.primaryIntent} (${intent.queryType})`,
      `Available integrations: ${perception.activeIntegrations.join(", ") || "none"}`,
      `Relevant memories: ${perception.relevantMemories.length}`,
      `Suggested tools: ${intent.suggestedTools.join(", ")}`,
    ].join("\n");

    const { object } = await generateObject({
      model,
      system: PLANNER_PROMPT,
      prompt: `Create an execution plan:\n\n${contextSummary}`,
      schema: z.object({
        steps: z.array(
          z.object({
            description: z.string(),
            action: z.string(),
            dependencies: z
              .array(z.string())
              .describe("IDs of steps this depends on"),
          }),
        ),
        requiresApproval: z
          .boolean()
          .describe("Whether this plan needs human approval before execution"),
        rollbackStrategy: z
          .string()
          .optional()
          .describe("How to undo if something goes wrong"),
      }),
      providerOptions: {
        openai: { strictJsonSchema: false },
      },
    });

    const plan: Plan = {
      id: `plan-${Date.now()}`,
      goalId: goal.id,
      steps: object.steps.map((step, index) => ({
        id: `step-${index + 1}`,
        order: index + 1,
        description: step.description,
        action: step.action,
        dependencies: step.dependencies,
        status: "pending" as const,
      })),
      estimatedComplexity: intent.complexity,
      requiresApproval: object.requiresApproval,
      rollbackStrategy: object.rollbackStrategy,
      createdAt: new Date(),
    };

    logger.info(
      `[CIM:Decision] Plan created in ${Date.now() - startTime}ms: ` +
        `${plan.steps.length} steps, approval=${plan.requiresApproval}`,
    );

    return plan;
  } catch (error) {
    logger.error(`[CIM:Decision] Planning failed, using fallback:`, error);
    return createSimplePlan(goal, intent);
  }
}

function createSimplePlan(goal: Goal, intent: IntentClassification): Plan {
  const steps: PlanStep[] = intent.suggestedTools.map((tool, index) => ({
    id: `step-${index + 1}`,
    order: index + 1,
    description: `${tool}: ${intent.primaryIntent}`,
    action: tool,
    dependencies: index > 0 ? [`step-${index}`] : [],
    status: "pending" as const,
  }));

  // Default single step if no tools suggested
  if (steps.length === 0) {
    steps.push({
      id: "step-1",
      order: 1,
      description: `Search memory for: ${goal.description}`,
      action: "memory_search",
      dependencies: [],
      status: "pending",
    });
  }

  return {
    id: `plan-${Date.now()}`,
    goalId: goal.id,
    steps,
    estimatedComplexity: "simple",
    requiresApproval: false,
    createdAt: new Date(),
  };
}

// ---------------------------------------------------------------------------
// Model Selector - Chooses appropriate model tier
// ---------------------------------------------------------------------------

export function selectModelTier(intent: IntentClassification): ModelTier {
  if (intent.complexity === "complex") return "high";
  if (intent.complexity === "simple" && intent.confidence > 0.8) return "low";
  return "high";
}

// ---------------------------------------------------------------------------
// Decision Pipeline - Full decide cycle
// ---------------------------------------------------------------------------

export async function decide(
  query: string,
  goal: Goal,
  perception: PerceptionResult,
  config: CIMEngineConfig,
): Promise<DecisionResult> {
  logger.info(`[CIM:Decision] Starting decision pipeline`);

  const intent = await classifyIntent(query, perception, config);
  const plan = await createPlan(goal, intent, perception, config);
  const selectedModel = selectModelTier(intent);

  const reasoning = [
    `Intent: ${intent.primaryIntent} (${intent.queryType}, confidence=${intent.confidence})`,
    `Complexity: ${intent.complexity}`,
    `Sources needed: ${intent.requiredSources.join(", ")}`,
    `Plan: ${plan.steps.length} steps, approval=${plan.requiresApproval}`,
    `Model tier: ${selectedModel}`,
  ].join(". ");

  logger.info(`[CIM:Decision] Decision complete: ${reasoning}`);

  return {
    intent,
    plan,
    selectedModel,
    reasoning,
  };
}
