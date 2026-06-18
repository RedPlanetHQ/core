/**
 * Decision Agent Types
 *
 * Core types for the Decision Agent system that handles non-user triggers
 * (scheduled tasks, webhooks, integration jobs) with intelligent reasoning.
 */

import type { MessageChannel } from "~/services/agent/types";

// ============================================================================
// Trigger Types
// ============================================================================

export type TriggerType =
  | "scheduled_task_fired"
  | "daily_sync"
  | "integration_webhook"
  | "memory_ingest"
  | "scheduled_check"
  | "task_completed"
  | "task_failed"
  | "task_timeout";

export interface BaseTrigger {
  type: TriggerType;
  timestamp: Date;
  userId: string;
  workspaceId: string;
  channel: MessageChannel;
  /** FK to Channel table — when set, delivery uses this specific channel record */
  channelId?: string | null;
}

export interface WebhookTriggerData {
  integration: string; // "gmail" | "calendar" | "github" etc.
  integrationAccountId: string; // internal UUID of the integration account
  accountId: string; // human-readable external identifier (e.g. "manoj@company.com")
  eventType: string; // "new_email" | "event_starting" etc.
  text?: string; // normalized activity content (emails, notifications, etc.)
  payload: Record<string, unknown>;
}

export interface SyncTriggerData {
  syncType: "daily" | "weekly";
  scheduledTime: Date;
}

export interface WebhookTrigger extends BaseTrigger {
  type: "integration_webhook";
  data: WebhookTriggerData;
}

export interface SyncTrigger extends BaseTrigger {
  type: "daily_sync";
  data: SyncTriggerData;
}

export interface ScheduledCheckTrigger extends BaseTrigger {
  type: "scheduled_check";
  data: {
    checkType: string;
    metadata?: Record<string, unknown>;
  };
}

export interface ScheduledTaskTriggerData {
  taskId: string;
  action: string;
  occurrenceNumber: number;
  previousResponses: ResponseSummary[];
  unrespondedCount: number;
  confirmedActive: boolean;
  isRecurring?: boolean;
}

export interface ScheduledTaskTrigger extends BaseTrigger {
  type: "scheduled_task_fired";
  data: ScheduledTaskTriggerData;
}

/**
 * Memory ingest trigger — fires once per session compact (NOT per aspect).
 * When the session-compaction job creates or updates a `Document` row for a
 * Mac-sourced session, the resulting summary is sent through the decision
 * pipeline so Watch Rules can identify task suggestions and surface them.
 *
 * Currently scoped to `source === "mac"`. Other sources (chat, integrations)
 * still flow through their existing triggers and are not re-routed through
 * memory_ingest.
 */
export interface MemoryIngestTriggerData {
  /** Origin of the compacted session — currently always "mac" for this trigger. */
  source: string;
  /** Session id that was compacted. */
  sessionId: string;
  /** Document row id (same row that `update_document`/UI shows). */
  documentId: string;
  /** Compaction title — short, human-readable. */
  title: string;
  /** Full compact summary text (markdown). The decision agent reads this to
   * find task suggestions. */
  summary: string;
  /** How many episodes were rolled into this compact. */
  episodeCount: number;
  /** Whether this is the first compaction for the session or an update. */
  kind: "created" | "updated";
}

export interface MemoryIngestTrigger extends BaseTrigger {
  type: "memory_ingest";
  data: MemoryIngestTriggerData;
}

export type Trigger =
  | ScheduledTaskTrigger
  | WebhookTrigger
  | SyncTrigger
  | ScheduledCheckTrigger
  | MemoryIngestTrigger;

// ============================================================================
// Goal & Response Types
// ============================================================================

export interface GoalInfo {
  description: string;
  metric?: string;
  target?: number;
  trackingMethod: "user_response" | "integration" | "manual";
}

export interface ResponseSummary {
  triggeredAt: Date;
  respondedAt?: Date;
  responseType: "completed" | "skipped" | "snoozed" | "no_response";
  responseText?: string;
}

export interface GoalProgress {
  goalId: string;
  description: string;
  current: number;
  target: number;
  unit?: string;
}

// ============================================================================
// Action Plan Types
// ============================================================================

export type MessageTone = "casual" | "urgent" | "encouraging" | "neutral";

export interface MessagePlan {
  intent: string;
  context: Record<string, unknown>;
  tone: MessageTone;
}

export interface FollowUpTask {
  title: string;
  schedule: string; // RRule string
  maxOccurrences?: number;
  parentTaskId?: string;
  channel?: MessageChannel;
}

export interface TaskUpdate {
  taskId: string;
  changes: {
    title?: string;
    description?: string;
    isActive?: boolean;
    schedule?: string;
    status?: string;
  };
}

export interface SilentAction {
  type: "log" | "update_state";
  description: string;
  data?: Record<string, unknown>;
}

export interface ActionPlan {
  shouldMessage: boolean;
  message?: MessagePlan;
  createFollowUps: FollowUpTask[];
  updateTasks: TaskUpdate[];
  silentActions: SilentAction[];
  reasoning: string;
}

// ============================================================================
// Decision Context Types
// ============================================================================

export interface UserState {
  timezone: string;
  userId?: string;
  workspaceId?: string;
  lastActiveAt?: Date;
  currentlyBusy: boolean;
  defaultChannel?: MessageChannel;
  availableChannels?: MessageChannel[];
}

export interface TodayState {
  goalProgress: GoalProgress[];
}

export interface RelevantHistory {
  recentMessages: Array<{
    role: "user" | "assistant" | "system";
    content: string;
    timestamp: Date;
  }>;
  patterns?: UserPatterns;
}

export interface UserPatterns {
  avgResponseTimeMinutes?: number;
  commonSkipReasons?: string[];
}

export interface GatheredData {
  calendar?: Array<{
    title: string;
    startTime: Date;
    endTime: Date;
    isAllDay: boolean;
  }>;
  emails?: Array<{
    from: string;
    subject: string;
    receivedAt: Date;
    isImportant: boolean;
  }>;
  integrationData?: Record<string, unknown>;
}

export interface DecisionContext {
  trigger: Trigger;
  user: UserState;
  todayState: TodayState;
  relevantHistory?: RelevantHistory;
  gatheredData?: GatheredData;
}

// ============================================================================
// Decision Agent Result
// ============================================================================

export interface DecisionAgentResult {
  plan: ActionPlan;
  executionTimeMs: number;
}
