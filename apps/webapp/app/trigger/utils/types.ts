import { type ActionStatusEnum } from "@core/types";
import { type ModelMessage as CoreMessage } from "ai";
import { z } from "zod";

// Define types for the MCP tool schema
export interface MCPTool {
  name: string;
  description: string;
  inputSchema: {
    type: string;
    properties: Record<string, SchemaProperty>;
    required?: string[];
    additionalProperties: boolean;
    $schema: string;
  };
}

// Vercel AI SDK Tool Types
export type VercelAITools = Record<
  string,
  {
    type: "function";
    description: string;
    parameters: {
      type: "object";
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      properties: Record<string, any>;
      required?: string[];
    };
  }
>;

export type SchemaProperty =
  | {
      type: string | string[];
      minimum?: number;
      maximum?: number;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      default?: any;
      minLength?: number;
      pattern?: string;
      enum?: string[];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      items?: any;
      properties?: Record<string, SchemaProperty>;
      required?: string[];
      additionalProperties?: boolean;
      description?: string;
    }
  | {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      anyOf: any[];
    };

export interface Resource {
  id?: string;
  size?: number;
  fileType: string;
  publicURL: string;
  originalName?: string;
}

export interface ExecutionState {
  query: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  context?: string;
  resources: Resource[];
  previousHistory?: CoreMessage[];
  history: HistoryStep[];
  userMemoryContext?: string;
  automationContext?: string;
  completed: boolean;
}

export interface TokenCount {
  inputTokens: number;
  outputToken: number;
}

export interface TotalCost {
  inputTokens: number;
  outputTokens: number;
  cost: number;
}

export interface HistoryStep {
  agent?: string;

  // The agent's reasoning process for this step
  thought?: string;

  // Indicates if this step contains a question for the user
  isQuestion?: boolean;
  // Indicates if this is the final response in the conversation
  isFinal?: boolean;
  isError?: boolean;

  // The name of the skill/tool being used in this step
  skill?: string;
  skillId?: string;
  skillInput?: string;
  skillOutput?: string;
  skillStatus?: ActionStatusEnum;

  // This is when the action has run and the output will be put here
  observation?: string;

  // This is what the user will read
  userMessage?: string;

  // If the agent has run completely
  completed?: boolean;

  // Token count
  tokenCount: TotalCost;

  finalTokenCount?: TotalCost;
}

export interface GenerateResponse {
  text: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  toolCalls: any[];
}
