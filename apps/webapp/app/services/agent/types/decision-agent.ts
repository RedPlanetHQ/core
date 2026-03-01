/**
 * Decision Agent Types
 *
 * Core types for the Decision Agent system that handles non-user triggers
 * (reminders, webhooks, scheduled jobs) with intelligent reasoning.
 */

import type { MessageChannel } from "~/services/agent/types";

// ============================================================================
// Trigger Types
// ============================================================================

export type TriggerType =
  | "reminder_fired"
  | "reminder_followup"
  | "daily_sync"
  | "integration_webhook"
  | "scheduled_check";

export interface BaseTrigger {
  type: TriggerType;
  timestamp: Date;
  userId: string;
  workspaceId: string;
  channel: MessageChannel;
}

export interface ReminderTriggerData {
  reminderId: string;
  action: string;
  goal?: GoalInfo;
  occurrenceNumber: number;
  previousResponses: ResponseSummary[];
  unrespondedCount: number;
  confirmedActive: boolean;
}

export interface WebhookTriggerData {
  integration: string; // "gmail" | "calendar" | "github" etc.
  eventType: string; // "new_email" | "event_starting" etc.
  payload: Record<string, unknown>;
}

export interface SyncTriggerData {
  syncType: "daily" | "weekly";
  scheduledTime: Date;
}

export interface ReminderTrigger extends BaseTrigger {
  type: "reminder_fired" | "reminder_followup";
  data: ReminderTriggerData;
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

export type Trigger =
  | ReminderTrigger
  | WebhookTrigger
  | SyncTrigger
  | ScheduledCheckTrigger;

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

export interface NewReminder {
  action: string;
  scheduledFor: Date | string; // absolute or relative like "in 30 minutes"
  channel: MessageChannel;
  goal?: GoalInfo;
  isFollowUp?: boolean;
  parentReminderId?: string;
}

export interface ReminderUpdate {
  reminderId: string;
  changes: {
    action?: string;
    isActive?: boolean;
    schedule?: string;
  };
}

export interface SilentAction {
  type: "log" | "update_state" | "integration_action";
  description: string;
  data?: Record<string, unknown>;
}

export interface ActionPlan {
  shouldMessage: boolean;
  message?: MessagePlan;
  createReminders: NewReminder[];
  updateReminders: ReminderUpdate[];
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
  defaultChannel?: "whatsapp" | "slack" | "email";
  availableChannels?: Array<"whatsapp" | "slack" | "email">;
}

export interface ReminderSummary {
  id: string;
  action: string;
  sentAt: Date;
  acknowledged: boolean;
  hasGoal: boolean;
}

export interface TodayState {
  remindersSent: ReminderSummary[];
  remindersAcknowledged: number;
  pendingFollowUps: Array<{
    reminderId: string;
    action: string;
    sentAt: Date;
  }>;
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
  preferredReminderTimes?: string[];
  commonSkipReasons?: string[];
  reminderCompletionRate?: number;
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
