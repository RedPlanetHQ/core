import { type ActionStatusEnum } from "@core/types";
import { type CoreMessage } from "ai";
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

export interface WebSearchResult {
  results: Array<{
    title: string;
    url: string;
    content: string;
    publishedDate: string;
    highlights: string[];
    text: string;
    score: number;
  }>;
}

export const WebSearchSchema = z.object({
  query: z
    .string()
    .min(1)
    .describe("The search query to find relevant web content"),
  numResults: z
    .number()
    .min(1)
    .max(20)
    .optional()
    .default(5)
    .describe("Number of results to return (1-20, default: 5)"),
  includeContent: z
    .boolean()
    .optional()
    .default(false)
    .describe("Whether to include full page content in results"),
  includeHighlights: z
    .boolean()
    .optional()
    .default(false)
    .describe("Whether to include relevant text highlights from pages"),
  domains: z
    .array(z.string())
    .optional()
    .describe(
      'Array of domains to include in search (e.g., ["github.com", "stackoverflow.com"])',
    ),
  excludeDomains: z
    .array(z.string())
    .optional()
    .describe("Array of domains to exclude from search"),
  startCrawlDate: z
    .string()
    .optional()
    .describe("Start date for content crawling in YYYY-MM-DD format"),
  endCrawlDate: z
    .string()
    .optional()
    .describe("End date for content crawling in YYYY-MM-DD format"),
  startPublishedDate: z
    .string()
    .optional()
    .describe("Start date for content publishing in YYYY-MM-DD format"),
  endPublishedDate: z
    .string()
    .optional()
    .describe("End date for content publishing in YYYY-MM-DD format"),
});

export type WebSearchArgs = z.infer<typeof WebSearchSchema>;
