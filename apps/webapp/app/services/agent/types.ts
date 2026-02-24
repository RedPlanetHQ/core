export interface SkillRef {
  id: string;
  title: string;
  metadata: Record<string, unknown> | null;
}

export type MessageChannel = "whatsapp" | "email" | "slack";

export type ExplorerType = "memory" | "integration";

export interface ExplorerResult {
  success: boolean;
  data: string;
  error?: string;
  metadata?: {
    executionTimeMs: number;
    toolCalls?: number;
  };
}

export interface TaskInput {
  explorerType: ExplorerType;
  query: string;
}

// Progressive messaging types
export type ProgressiveMessageType = "ack" | "header" | "data" | "insight";

export interface ProgressiveMessage {
  type: ProgressiveMessageType;
  content: string;
}

export interface ProgressiveCallback {
  (message: ProgressiveMessage): Promise<void>;
}

export interface AgentResponse {
  // For WhatsApp: array of messages sent progressively
  // For Email: single comprehensive response
  messages: string[];
  metadata?: {
    executionTimeMs: number;
    toolCalls?: number;
  };
}

// UI Types for streaming agents with useChat
import type { InferAgentUIMessage, ToolLoopAgent } from "ai";

// Type placeholder - will be properly typed when you create the actual agent instance
// This should be imported where you instantiate your ToolLoopAgent
export type CoreAgentMessage = InferAgentUIMessage<ToolLoopAgent<any>>;

// Helper types for UI components
export interface CoreAgentToolPart {
  type: 'tool-gather_context' | 'tool-take_action';
  state: 'input-streaming' | 'input-available' | 'output-available' | 'output-error';
  preliminary?: boolean;
  input?: any;
  output?: {
    parts: Array<{
      type: string;
      text?: string;
      [key: string]: any;
    }>;
  };
}

// Helper functions for UI
export const isStreaming = (part: CoreAgentToolPart): boolean => {
  return part.state === 'output-available' && part.preliminary === true;
};

export const isComplete = (part: CoreAgentToolPart): boolean => {
  return part.state === 'output-available' && !part.preliminary;
};

export const hasOutput = (part: CoreAgentToolPart): boolean => {
  return part.state === 'output-available';
};
