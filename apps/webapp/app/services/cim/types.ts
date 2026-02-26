/**
 * CIM (Cognitive Intelligence Module) Architecture - Type Definitions
 *
 * Implements the three-component agent architecture:
 *   1. Perception  - How the agent sees the world
 *   2. Decision    - How the agent chooses what to do
 *   3. Action      - How the agent affects the world
 *
 * Based on production agent patterns: goal-driven behavior,
 * structured planning, guardrails, failure handling, and
 * multi-agent orchestration.
 */

// ---------------------------------------------------------------------------
// Core Enums
// ---------------------------------------------------------------------------

export type AgentStatus =
  | "idle"
  | "perceiving"
  | "planning"
  | "deciding"
  | "acting"
  | "waiting_human"
  | "completed"
  | "failed";

export type FailureStrategy = "retry" | "escalate" | "abort" | "fallback";

export type GuardrailAction = "allow" | "deny" | "require_approval";

export type PermissionLevel = "read" | "write" | "admin";

export type PlanStepStatus = "pending" | "in_progress" | "completed" | "failed" | "skipped";

export type HeartbeatCheckType =
  | "email"
  | "calendar"
  | "slack"
  | "github"
  | "linear"
  | "custom";

export type ModelTier = "high" | "low" | "background";

export type AgentRole =
  | "orchestrator"
  | "researcher"
  | "writer"
  | "executor"
  | "monitor"
  | "analyst"
  | "custom";

// ---------------------------------------------------------------------------
// Perception Layer
// ---------------------------------------------------------------------------

export interface PerceptionSource {
  type: "memory" | "integration" | "web" | "document" | "user_input";
  provider?: string;
  confidence: number;
}

export interface ObservedState {
  timestamp: Date;
  sources: PerceptionSource[];
  context: Record<string, unknown>;
  entities: string[];
  summary: string;
}

export interface PerceptionResult {
  state: ObservedState;
  relevantMemories: MemoryFragment[];
  activeIntegrations: string[];
  pendingEvents: PerceptionEvent[];
}

export interface PerceptionEvent {
  source: string;
  type: string;
  data: Record<string, unknown>;
  timestamp: Date;
  priority: "low" | "medium" | "high" | "critical";
}

export interface MemoryFragment {
  id: string;
  content: string;
  aspect?: string;
  relevanceScore: number;
  createdAt: Date;
  source: string;
}

// ---------------------------------------------------------------------------
// Decision Layer
// ---------------------------------------------------------------------------

export interface Goal {
  id: string;
  description: string;
  successCriteria: string[];
  priority: number;
  deadline?: Date;
  parentGoalId?: string;
}

export interface Plan {
  id: string;
  goalId: string;
  steps: PlanStep[];
  estimatedComplexity: "simple" | "moderate" | "complex";
  requiresApproval: boolean;
  rollbackStrategy?: string;
  createdAt: Date;
}

export interface PlanStep {
  id: string;
  order: number;
  description: string;
  action: string;
  dependencies: string[];
  status: PlanStepStatus;
  result?: ActionResult;
  estimatedDurationMs?: number;
}

export interface IntentClassification {
  primaryIntent: string;
  confidence: number;
  queryType: "aspect" | "entity" | "temporal" | "exploratory" | "relationship";
  requiredSources: PerceptionSource["type"][];
  suggestedTools: string[];
  complexity: "simple" | "moderate" | "complex";
}

export interface DecisionResult {
  intent: IntentClassification;
  plan: Plan;
  selectedModel: ModelTier;
  reasoning: string;
}

// ---------------------------------------------------------------------------
// Action Layer
// ---------------------------------------------------------------------------

export interface ActionRequest {
  id: string;
  tool: string;
  parameters: Record<string, unknown>;
  permissions: PermissionLevel;
  timeout?: number;
  retryConfig?: RetryConfig;
}

export interface ActionResult {
  requestId: string;
  success: boolean;
  data?: unknown;
  error?: string;
  executionTimeMs: number;
  toolCalls: number;
  logged: boolean;
  reversible: boolean;
}

export interface RetryConfig {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  backoffMultiplier: number;
}

export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxAttempts: 3,
  baseDelayMs: 1000,
  maxDelayMs: 16000,
  backoffMultiplier: 2,
};

// ---------------------------------------------------------------------------
// Guardrails
// ---------------------------------------------------------------------------

export interface Guardrail {
  id: string;
  name: string;
  description: string;
  check: (request: ActionRequest) => GuardrailAction;
  priority: number;
}

export interface GuardrailResult {
  action: GuardrailAction;
  guardrailId: string;
  reason: string;
}

export interface PermissionPolicy {
  agentId: string;
  integration: string;
  allowedActions: string[];
  deniedActions: string[];
  rateLimit?: RateLimit;
}

export interface RateLimit {
  maxRequests: number;
  windowMs: number;
  currentCount: number;
  windowStart: Date;
}

// ---------------------------------------------------------------------------
// Soul Configuration (Agent Identity)
// ---------------------------------------------------------------------------

export interface SoulConfig {
  identity: {
    name: string;
    role: string;
    description: string;
  };
  personality: {
    tone: string;
    verbosity: "concise" | "moderate" | "detailed";
    formality: "casual" | "neutral" | "formal";
  };
  directives: string[];
  constraints: string[];
  expertise: string[];
  anchors: AnchorRule[];
}

export interface AnchorRule {
  id: string;
  rule: string;
  priority: "critical" | "high" | "medium" | "low";
  neverCompact: boolean;
}

// ---------------------------------------------------------------------------
// Memory Management
// ---------------------------------------------------------------------------

export interface ContextWindow {
  activeTaskContext: string;
  maxTokens: number;
  currentTokens: number;
  items: ContextItem[];
}

export interface ContextItem {
  id: string;
  content: string;
  tokenCount: number;
  priority: number;
  source: string;
  addedAt: Date;
  expiresAt?: Date;
}

export interface ExternalMemoryEntry {
  id: string;
  type: "task_summary" | "decision_log" | "error_log" | "audit_trail";
  content: string;
  metadata: Record<string, unknown>;
  createdAt: Date;
  agentId: string;
}

// ---------------------------------------------------------------------------
// Multi-Agent Orchestration
// ---------------------------------------------------------------------------

export interface AgentDefinition {
  id: string;
  role: AgentRole;
  name: string;
  description: string;
  soulConfig: SoulConfig;
  permissions: PermissionPolicy[];
  modelTier: ModelTier;
  tools: string[];
}

export interface AgentTeam {
  id: string;
  name: string;
  agents: AgentDefinition[];
  coordinatorId: string;
  sharedContext: Record<string, unknown>;
}

export interface ContextBundle {
  userId: string;
  workspaceId: string;
  userContext: string;
  currentGoal: string;
  constraints: string[];
  sharedMemory: ExternalMemoryEntry[];
  parentAgentId?: string;
  verificationRequired: boolean;
}

export interface AgentMessage {
  fromAgentId: string;
  toAgentId: string;
  type: "task" | "result" | "handoff" | "escalation" | "status";
  payload: Record<string, unknown>;
  timestamp: Date;
}

// ---------------------------------------------------------------------------
// Heartbeat System
// ---------------------------------------------------------------------------

export interface HeartbeatConfig {
  enabled: boolean;
  intervalMs: number;
  checks: HeartbeatCheck[];
  activeHours: { start: number; end: number };
  timezone: string;
  modelTier: ModelTier;
}

export interface HeartbeatCheck {
  id: string;
  type: HeartbeatCheckType;
  integration?: string;
  query: string;
  priority: "low" | "medium" | "high";
  lastRun?: Date;
  lastResult?: string;
}

export interface HeartbeatResult {
  checkId: string;
  timestamp: Date;
  findings: HeartbeatFinding[];
  nextScheduledRun: Date;
}

export interface HeartbeatFinding {
  source: string;
  summary: string;
  priority: "low" | "medium" | "high" | "critical";
  actionRequired: boolean;
  suggestedAction?: string;
}

// ---------------------------------------------------------------------------
// CIM Engine (Top-Level Loop)
// ---------------------------------------------------------------------------

export interface CIMEngineConfig {
  userId: string;
  workspaceId: string;
  timezone: string;
  source: string;
  soulConfig?: SoulConfig;
  heartbeat?: HeartbeatConfig;
  guardrails?: Guardrail[];
  maxLoopIterations: number;
  modelTier: ModelTier;
}

export interface CIMLoopState {
  iteration: number;
  status: AgentStatus;
  goal: Goal;
  plan?: Plan;
  perception: PerceptionResult;
  actionHistory: ActionResult[];
  errors: CIMError[];
  startedAt: Date;
  completedAt?: Date;
}

export interface CIMError {
  phase: "perception" | "decision" | "action" | "planning";
  message: string;
  recoverable: boolean;
  timestamp: Date;
  context?: Record<string, unknown>;
}

export interface CIMResult {
  success: boolean;
  goalMet: boolean;
  finalState: CIMLoopState;
  summary: string;
  auditTrail: ExternalMemoryEntry[];
}
