export type MessageChannel = 'whatsapp' | 'email';

export type ExplorerType = 'memory' | 'integration';

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
export type ProgressiveMessageType = 'ack' | 'header' | 'data' | 'insight';

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
