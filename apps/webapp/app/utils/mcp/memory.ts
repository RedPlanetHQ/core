import {
  handleUserProfile,
  handleMemoryIngest,
  handleMemorySearch,
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

// Memory tool schemas (from existing memory endpoint)
const SearchParamsSchema = {
  type: "object",
  properties: {
    query: {
      type: "string",
      description:
        "Search query optimized for knowledge graph retrieval. Choose the right query structure based on your search intent:\n\n" +
        "1. **Entity-Centric Queries** (Best for graph search):\n" +
        '   - ✅ GOOD: "User\'s preferences for code style and formatting"\n' +
        '   - ✅ GOOD: "Project authentication implementation decisions"\n' +
        '   - ❌ BAD: "user code style"\n' +
        "   - Format: [Person/Project] + [relationship/attribute] + [context]\n\n" +
        "2. **Multi-Entity Relationship Queries** (Excellent for episode graph):\n" +
        '   - ✅ GOOD: "User and team discussions about API design patterns"\n' +
        '   - ✅ GOOD: "relationship between database schema and performance optimization"\n' +
        '   - ❌ BAD: "user team api design"\n' +
        "   - Format: [Entity1] + [relationship type] + [Entity2] + [context]\n\n" +
        "3. **Semantic Question Queries** (Good for vector search):\n" +
        '   - ✅ GOOD: "What causes authentication errors in production? What are the security requirements?"\n' +
        '   - ✅ GOOD: "How does caching improve API response times compared to direct database queries?"\n' +
        '   - ❌ BAD: "auth errors production"\n' +
        "   - Format: Complete natural questions with full context\n\n" +
        "4. **Concept Exploration Queries** (Good for BFS traversal):\n" +
        '   - ✅ GOOD: "concepts and ideas related to database indexing and query optimization"\n' +
        '   - ✅ GOOD: "topics connected to user authentication and session management"\n' +
        '   - ❌ BAD: "database indexing concepts"\n' +
        "   - Format: [concept] + related/connected + [domain/context]\n\n" +
        "Avoid keyword soup queries - use complete phrases with proper context for best results.",
    },
    validAt: {
      type: "string",
      description:
        "Optional: ISO timestamp (like '2024-01-15T10:30:00Z'). Get facts that were true at this specific time. Leave empty for current facts.",
    },
    startTime: {
      type: "string",
      description:
        "Optional: ISO timestamp (like '2024-01-01T00:00:00Z'). Only find memories created AFTER this time. " +
        "USE WHEN: User asks for 'recent', 'this week', 'last month', 'since X date' queries. " +
        "EXAMPLES: " +
        "- 'recent work' → set startTime to 7 days ago; " +
        "- 'this week' → set startTime to start of current week; " +
        "- 'since January' → set startTime to '2025-01-01T00:00:00Z'. " +
        "IMPORTANT: Calculate relative dates from today's date (see system context). Combine with sortBy='recency' for chronological timeline.",
    },
    endTime: {
      type: "string",
      description:
        "Optional: ISO timestamp (like '2024-12-31T23:59:59Z'). Only find memories created BEFORE this time. " +
        "USE WHEN: User asks for historical queries like 'before X date', 'until last month', or specific time ranges. " +
        "EXAMPLES: " +
        "- 'work from last month' → set startTime to first day of last month, endTime to last day of last month; " +
        "- 'before March' → set endTime to '2025-03-01T00:00:00Z'; " +
        "- 'between Jan and Mar' → set startTime='2025-01-01T00:00:00Z', endTime='2025-03-31T23:59:59Z'. " +
        "IMPORTANT: Use with startTime to define time windows. Always use ISO format with timezone (Z for UTC).",
    },
    labelIds: {
      type: "array",
      items: {
        type: "string",
      },
      description:
        "Optional: Array of label UUIDs to filter search results. Leave empty to search all labels.",
    },
    sortBy: {
      type: "string",
      enum: ["relevance", "recency"],
      description:
        "Optional: Sort results by 'relevance' (default, best semantic matches ranked by rerank score) or 'recency' (chronological order, newest first). Use 'relevance' for conceptual questions and 'recency' for timeline/recent activity queries.",
    },
  },
  required: ["query"],
};

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
      readOnly: false,
      idempotent: false,
      destructive: false,
    },
  },
  {
    name: "memory_search",
    description:
      "Search stored memories for past conversations, user preferences, project context, and decisions. USE THIS TOOL: 1) At start of every conversation to find related context, 2) When user mentions past work or projects, 3) Before answering questions that might have previous context. HOW TO USE: Write a simple query describing what to find (e.g., 'user code preferences', 'authentication bugs', 'API setup steps'). Returns: Markdown-formatted context optimized for LLM consumption, including session compacts, episodes, and key facts with temporal metadata.",
    inputSchema: SearchParamsSchema,
    annotations: {
      readOnly: true,
      idempotent: true,
      destructive: false,
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
      readOnly: true,
      idempotent: true,
      destructive: false,
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
      readOnly: true,
      idempotent: true,
      destructive: false,
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
      readOnly: true,
      idempotent: true,
      destructive: false,
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
      readOnly: true,
      idempotent: true,
      destructive: false,
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
      readOnly: false,
      idempotent: false,
      destructive: false,
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
      readOnly: true,
      idempotent: true,
      destructive: false,
    },
  },
  {
    name: "get_integration_actions",
    description:
      "Get ONLY the most relevant action names for a specific integration based on user's intent. USE THIS TOOL: Before execute_integration_action to discover which actions can fulfill the user's request. The LLM intelligently filters available actions to return ONLY the most relevant ones (typically 1-3 actions), preventing context bloat. For example: query='get latest issues' returns ['get_issues'], NOT ['get_issues', 'get_issue', 'get_comments']. HOW TO USE: Provide integrationSlug (from get_integrations) and a clear query describing what you want to accomplish. Returns: Array of 1-3 relevant action names (strings only, not full schemas). Use these action names with execute_integration_action.",
    inputSchema: {
      type: "object",
      properties: {
        integrationSlug: {
          type: "string",
          description:
            "Slug from get_integrations. Examples: 'github', 'linear', 'slack'",
        },
        query: {
          type: "string",
          description:
            "Clear description of what you want to accomplish. Examples: 'get the latest issues', 'create a new pull request', 'send a message to #general'. Be specific - the LLM uses this to filter down to 1-3 most relevant actions.",
        },
      },
      required: ["integrationSlug", "query"],
    },
    annotations: {
      readOnly: true,
      idempotent: true,
      destructive: false,
    },
  },
  {
    name: "execute_integration_action",
    description:
      "Execute an action on an integration (fetch GitHub PR, create Linear issue, send Slack message, etc.). USE THIS TOOL: After using get_integration_actions to see available actions. HOW TO USE: 1) Set integrationSlug (like 'github'), 2) Set action name (like 'get_pr'), 3) Set parameters object with required parameters from the action's inputSchema. Returns: Result of the action execution.",
    inputSchema: {
      type: "object",
      properties: {
        integrationSlug: {
          type: "string",
          description:
            "Slug from get_integrations. Examples: 'github', 'linear', 'slack'",
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
      required: ["integrationSlug", "action"],
    },
    annotations: {
      readOnly: false,
      idempotent: false,
      destructive: false,
    },
  },
  // {
  //   name: "memory_deep_search",
  //   description:
  //     "Search CORE memory with document context and get synthesized insights. Automatically analyzes content to infer intent (reading, writing, meeting prep, research, task tracking, etc.) and provides context-aware synthesis. USE THIS TOOL: When analyzing documents, emails, notes, or any substantial text content for relevant memories. HOW TO USE: Provide the full content text. The tool will decompose it, search for relevant memories, and synthesize findings based on inferred intent. Returns: Synthesized context summary and related episodes.",
  //   inputSchema: {
  //     type: "object",
  //     properties: {
  //       content: {
  //         type: "string",
  //         description:
  //           "Full document/text content to analyze and search against memory",
  //       },
  //       intentOverride: {
  //         type: "string",
  //         description:
  //           "Optional: Explicitly specify intent (e.g., 'meeting preparation', 'blog writing') instead of auto-detection",
  //       },
  //     },
  //     required: ["content"],
  //   },
  // },
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
        return await handleMemorySearch({ ...args, userId, source });
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
        return await handleExecuteIntegrationAction({ ...args });
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
