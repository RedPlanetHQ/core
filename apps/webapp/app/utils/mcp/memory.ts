import {
  handleUserProfile,
  handleMemoryIngest,
  handleGetDocuments,
  handleGetDocument,
  handleGetLabels,
  handleGetSessionId,
} from "./memory-operations";
import {
  handleGetIntegrations,
  handleGetIntegrationActions,
  handleExecuteIntegrationAction,
} from "./integration-operations";
import { searchMemoryWithAgent } from "~/services/agent/memory";

const IngestSchema = {
  type: "object",
  properties: {
    message: {
      type: "string",
      description:
        "The conversation text to store. Include both what the user asked and what you answered. Keep it concise but complete.",
    },
    sessionId: {
      type: "string",
      description:
        "IMPORTANT: Session ID (UUID) is required to track the conversation session. If you don't have a sessionId in your context, you MUST call the initialize_conversation_session tool first to obtain one before calling memory_ingest.",
    },
    labelIds: {
      type: "array",
      items: {
        type: "string",
      },
      description:
        "Optional: Array of label UUIDs (from get_labels). Add this to organize the memory by topic or project. Example: If discussing 'core' project, include the 'core' label ID. Leave empty to store without specific labels.",
    },
  },
  required: ["message", "sessionId"],
};

export const memoryTools = [
  {
    name: "memory_ingest",
    description:
      "Store conversation in memory for future reference. USE THIS TOOL: At the END of every conversation after fully answering the user. WHAT TO STORE: 1) User's question or request, 2) Your solution or explanation, 3) Important decisions made, 4) Key insights discovered. HOW TO USE: Put the entire conversation summary in the 'message' field. IMPORTANT: You MUST provide a sessionId - if you don't have one, call initialize_conversation_session tool FIRST to obtain it at the start of the conversation, then use that SAME sessionId for all memory_ingest calls. Optionally add labelIds array to organize by topic. Returns: Success confirmation with storage ID.",
    inputSchema: IngestSchema,
    annotations: {
      readOnlyHint: false,
      idempotentHint: false,
      destructiveHint: false,
    },
  },
  {
    name: "memory_search",
    description:
      "Intelligent memory search agent that analyzes user intent and performs multiple parallel searches when needed to gather comprehensive context. USE THIS TOOL: When you need deep contextual understanding that might require multiple search angles, or when the query is complex and multifaceted. The agent will automatically decompose your intent into optimal search queries, execute them in parallel, and synthesize the results. BENEFITS: Handles complex multi-faceted queries, automatically determines best query patterns (entity-centric, temporal, relationship-based, semantic). HOW TO USE: Provide a natural language description of what context you need. Examples: 'What do we know about the authentication implementation and related bugs?', 'Recent work on MCP integrations and configuration', 'User preferences for code style and project setup'. Returns: Synthesized response with relevant context from multiple search angles.",
    inputSchema: {
      type: "object",
      properties: {
        intent: {
          type: "string",
          description:
            "Natural language description of what memory context you need. Be specific about what you're looking for. The agent will decompose this into multiple optimal searches.",
        },
      },
      required: ["intent"],
    },
    annotations: {
      readOnlyHint: true,
      idempotentHint: true,
      destructiveHint: false,
    },
  },
  {
    name: "get_labels",
    description:
      "List all workspace labels. USE THIS TOOL: To discover available labels and get their IDs for filtering memories. Labels organize episodes and conversations by topic or project. Returns: Array of labels with id, name, description, and color.",
    inputSchema: {
      type: "object",
      properties: {},
    },
    annotations: {
      readOnlyHint: true,
      idempotentHint: true,
      destructiveHint: false,
    },
  },
  {
    name: "memory_about_user",
    description:
      "Get user's profile information (background, preferences, work, interests). USE THIS TOOL: At the start of conversations to understand who you're helping. This provides context about the user's technical preferences, work style, and personal details. Returns: User profile summary as text.",
    inputSchema: {
      type: "object",
      properties: {
        profile: {
          type: "boolean",
          description:
            "Set to true to get full profile. Leave empty for default profile view.",
        },
      },
    },
    annotations: {
      readOnlyHint: true,
      idempotentHint: true,
      destructiveHint: false,
    },
  },
  {
    name: "memory_get_documents",
    description:
      "List all user documents. USE THIS TOOL: To discover available documents and get their IDs. Each document represents stored content with a unique Id. Returns: Array of documents with id, title, createdAt.",
    inputSchema: {
      type: "object",
      properties: {
        limit: {
          type: "number",
          description:
            "Optional: Maximum number of documents to return. Defaults to 50.",
        },
      },
    },
    annotations: {
      readOnlyHint: true,
      idempotentHint: true,
      destructiveHint: false,
    },
  },
  {
    name: "memory_get_document",
    description:
      "Get detailed information about a specific document including its content. USE THIS TOOL: When you need to retrieve document content by its ID. HOW TO USE: Provide the documentId (ID from get_documents). Returns: Document details with id, title, content, metadata, source, createdAt.",
    inputSchema: {
      type: "object",
      properties: {
        documentId: {
          type: "string",
          description:
            "Id of the document (required). Get this from get_documents tool.",
        },
      },
      required: ["documentId"],
    },
    annotations: {
      readOnlyHint: true,
      idempotentHint: true,
      destructiveHint: false,
    },
  },
  {
    name: "initialize_conversation_session",
    description:
      "Initialize a session for this conversation. MUST be called FIRST at the start of every conversation before any memory_ingest calls. This generates a unique UUID that tracks the entire conversation session. IMPORTANT: One conversation = one session. Call this tool once at the beginning, store the returned sessionId, and use that SAME sessionId for ALL memory_ingest operations throughout this conversation. DO NOT create custom session IDs. Returns: A UUID string to use as sessionId for all subsequent memory operations.",
    inputSchema: {
      type: "object",
      properties: {
        new: {
          type: "boolean",
          description: "Set to true to initialize a new conversation session.",
        },
      },
    },
    annotations: {
      readOnlyHint: false,
      idempotentHint: false,
      destructiveHint: false,
    },
  },
  {
    name: "get_integrations",
    description:
      "List all connected integrations (GitHub, Linear, Slack, etc.). USE THIS TOOL: Before using integration actions to see what's available. WORKFLOW: 1) Call this to see available integrations, 2) Call get_integration_actions with a slug to see what you can do, 3) Call execute_integration_action to do it. Returns: Array with slug, name, accountId, and hasMcp for each integration.",
    inputSchema: {
      type: "object",
      properties: {},
    },
    annotations: {
      readOnlyHint: true,
      idempotentHint: true,
      destructiveHint: false,
    },
  },
  {
    name: "get_integration_actions",
    description:
      "Get ONLY the most relevant action names for a specific integration account based on user's intent. USE THIS TOOL: Before execute_integration_action to discover which actions can fulfill the user's request. The LLM intelligently filters available actions to return ONLY the most relevant ones (typically 1-3 actions), preventing context bloat. For example: query='get latest issues' returns ['get_issues'], NOT ['get_issues', 'get_issue', 'get_comments']. HOW TO USE: Provide accountId (from get_integrations) and a clear query describing what you want to accomplish. Returns: Array of 1-3 relevant action names (strings only, not full schemas). Use these action names with execute_integration_action.",
    inputSchema: {
      type: "object",
      properties: {
        accountId: {
          type: "string",
          description:
            "Account ID from get_integrations. This identifies the specific integration account to use.",
        },
        query: {
          type: "string",
          description:
            "Clear description of what you want to accomplish. Examples: 'get the latest issues', 'create a new pull request', 'send a message to #general'. Be specific - the LLM uses this to filter down to 1-3 most relevant actions.",
        },
      },
      required: ["accountId", "query"],
    },
    annotations: {
      readOnlyHint: true,
      idempotentHint: true,
      destructiveHint: false,
    },
  },
  {
    name: "execute_integration_action",
    description:
      "Execute an action on an integration account (fetch GitHub PR, create Linear issue, send Slack message, etc.). USE THIS TOOL: After using get_integration_actions to see available actions. HOW TO USE: 1) Set accountId (from get_integrations) to specify which account to use, 2) Set action name (like 'get_pr'), 3) Set parameters object with required parameters from the action's inputSchema. Returns: Result of the action execution.",
    inputSchema: {
      type: "object",
      properties: {
        accountId: {
          type: "string",
          description:
            "Account ID from get_integrations. This identifies the specific integration account to use.",
        },
        action: {
          type: "string",
          description:
            "Action name from get_integration_actions. Examples: 'get_pr', 'get_issues', 'create_issue'",
        },
        parameters: {
          type: "object",
          description:
            "Parameters for the action. Check the action's inputSchema from get_integration_actions to see what's required.",
        },
      },
      required: ["accountId", "action"],
    },
    annotations: {
      readOnlyHint: false,
      idempotentHint: false,
      destructiveHint: true,
    },
  },
];

// Function to call memory tools based on toolName
export async function callMemoryTool(
  toolName: string,
  args: any,
  userId: string,
  source: string,
) {
  try {
    switch (toolName) {
      case "memory_ingest":
        return await handleMemoryIngest({ ...args, userId, source });
      case "memory_search":
        return await searchMemoryWithAgent(args.intent, userId, args.workspaceId, source);
      case "get_labels":
        return await handleGetLabels({ ...args, userId });
      case "memory_about_user":
        return await handleUserProfile(args.workspaceId);
      case "memory_get_documents":
        return await handleGetDocuments({ ...args, userId });
      case "memory_get_document":
        return await handleGetDocument({ ...args, userId });
      case "initialize_conversation_session":
        return await handleGetSessionId();
      case "get_integrations":
        return await handleGetIntegrations({ ...args, userId });
      case "get_integration_actions":
        return await handleGetIntegrationActions({ ...args });
      case "execute_integration_action":
        return await handleExecuteIntegrationAction({ ...args, source });
      // case "memory_deep_search":
      //   return await handleMemoryDeepSearch({ ...args, userId, source });
      default:
        throw new Error(`Unknown memory tool: ${toolName}`);
    }
  } catch (error) {
    console.error(`Error calling memory tool ${toolName}:`, error);
    return {
      content: [
        {
          type: "text",
          text: `Error calling memory tool: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
      isError: true,
    };
  }
}
