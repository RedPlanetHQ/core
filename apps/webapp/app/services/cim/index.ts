/**
 * CIM - Cognitive Intelligence Module
 *
 * A comprehensive agent architecture for CORE that implements
 * goal-driven behavior with three core components:
 *
 *   1. PERCEPTION  - How the agent sees the world
 *      - State observation (integrations, environment)
 *      - Context gathering (memory, knowledge graph)
 *
 *   2. DECISION    - How the agent chooses what to do
 *      - Intent classification (5 query types, 3 complexity levels)
 *      - Planning (goal decomposition, dependency ordering)
 *      - Model selection (cost-optimized tier assignment)
 *
 *   3. ACTION      - How the agent affects the world
 *      - Guarded execution (permission checks, rate limits)
 *      - Retry with backoff (transient failure handling)
 *      - Audit logging (every action tracked)
 *
 * Additional subsystems:
 *   - Memory Manager: Context window + external memory + soul config
 *   - Guardrails: Hard limits, permission policies, rate limiting
 *   - Heartbeat: Periodic background monitoring
 *   - Multi-Agent: Team orchestration, context bundling, message passing
 *
 * Usage:
 *   import { runCIM } from "~/services/cim";
 *
 *   const result = await runCIM(
 *     "What meetings do I have this week?",
 *     userId,
 *     workspaceId,
 *     { timezone: "America/New_York" },
 *   );
 */

// Engine
export { runCIMLoop, runCIM, createGoal } from "./cim-engine";

// Types
export type {
  // Core
  AgentStatus,
  FailureStrategy,
  GuardrailAction,
  PermissionLevel,
  PlanStepStatus,
  ModelTier,
  AgentRole,
  // Perception
  PerceptionSource,
  ObservedState,
  PerceptionResult,
  PerceptionEvent,
  MemoryFragment,
  // Decision
  Goal,
  Plan,
  PlanStep,
  IntentClassification,
  DecisionResult,
  // Action
  ActionRequest,
  ActionResult,
  RetryConfig,
  // Guardrails
  Guardrail,
  GuardrailResult,
  PermissionPolicy,
  RateLimit,
  // Soul
  SoulConfig,
  AnchorRule,
  // Memory
  ContextWindow,
  ContextItem,
  ExternalMemoryEntry,
  // Multi-Agent
  AgentDefinition,
  AgentTeam,
  ContextBundle,
  AgentMessage,
  // Heartbeat
  HeartbeatConfig,
  HeartbeatCheck,
  HeartbeatResult,
  HeartbeatFinding,
  // Engine
  CIMEngineConfig,
  CIMLoopState,
  CIMError,
  CIMResult,
} from "./types";

export { DEFAULT_RETRY_CONFIG } from "./types";

// Perception
export { perceive, observeState, gatherContext } from "./perception";

// Decision
export { decide, classifyIntent, createPlan, selectModelTier } from "./decision";

// Action
export { executeAction, executeWithRetry, createAuditEntry } from "./action";

// Guardrails
export {
  checkGuardrails,
  isActionAllowed,
  requiresApproval,
  checkRateLimit,
  checkPermission,
  checkStepGuardrails,
} from "./guardrails";

// Memory Manager
export {
  createContextWindow,
  addToContext,
  clearExpiredItems,
  getContextSummary,
  estimateTokens,
  writeToExternalMemory,
  readExternalMemory,
  getAuditTrail,
  createTaskSummary,
  createDefaultSoulConfig,
  getSoulPrompt,
  logDecision,
  logError,
} from "./memory-manager";

// Heartbeat
export {
  createDefaultHeartbeatConfig,
  isWithinActiveHours,
  runHeartbeatCheck,
  runHeartbeatCycle,
  formatHeartbeatSummary,
} from "./heartbeat";

// Multi-Agent
export {
  registerAgent,
  getAgent,
  listAgents,
  removeAgent,
  createAgentDefinition,
  createTeam,
  getTeam,
  createContextBundle,
  bundleToPrompt,
  sendMessage,
  getMessages,
  createHandoff,
  createEscalation,
} from "./multi-agent";
