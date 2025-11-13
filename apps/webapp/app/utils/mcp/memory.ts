import { randomUUID } from "node:crypto";
import { EpisodeTypeEnum } from "@core/types";
import { addToQueue } from "~/lib/ingest.server";
import { logger } from "~/services/logger.service";
import { SearchService } from "~/services/search.server";
import { IntegrationLoader } from "./integration-loader";
import { hasCredits } from "~/services/billing.server";
import { prisma } from "~/db.server";

const searchService = new SearchService();

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
    spaceIds: {
      type: "array",
      items: {
        type: "string",
      },
      description:
        "Optional: Array of space UUIDs to search within. Leave empty to search all spaces.",
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
    spaceIds: {
      type: "array",
      items: {
        type: "string",
      },
      description:
        "Optional: Array of space UUIDs (from memory_get_spaces). Add this to organize the memory by project. Example: If discussing 'core' project, include the 'core' space ID. Leave empty to store in general memory.",
    },
  },
  required: ["message", "sessionId"],
};

export const memoryTools = [
  {
    name: "memory_ingest",
    description:
      "Store conversation in memory for future reference. USE THIS TOOL: At the END of every conversation after fully answering the user. WHAT TO STORE: 1) User's question or request, 2) Your solution or explanation, 3) Important decisions made, 4) Key insights discovered. HOW TO USE: Put the entire conversation summary in the 'message' field. IMPORTANT: You MUST provide a sessionId - if you don't have one, call initialize_conversation_session tool FIRST to obtain it at the start of the conversation, then use that SAME sessionId for all memory_ingest calls. Optionally add spaceIds array to organize by project. Returns: Success confirmation with storage ID.",
    inputSchema: IngestSchema,
  },
  {
    name: "memory_search",
    description:
      "Search stored memories for past conversations, user preferences, project context, and decisions. USE THIS TOOL: 1) At start of every conversation to find related context, 2) When user mentions past work or projects, 3) Before answering questions that might have previous context. HOW TO USE: Write a simple query describing what to find (e.g., 'user code preferences', 'authentication bugs', 'API setup steps'). Returns: Markdown-formatted context optimized for LLM consumption, including session compacts, episodes, and key facts with temporal metadata.",
    inputSchema: SearchParamsSchema,
  },
  {
    name: "memory_get_spaces",
    description:
      "List all available memory spaces (project contexts). USE THIS TOOL: To see what spaces exist before searching or storing memories. Each space organizes memories by topic (e.g., 'Profile' for user info, 'GitHub' for GitHub work, project names for project-specific context). Returns: Array of spaces with id, name, and description.",
    inputSchema: {
      type: "object",
      properties: {
        all: {
          type: "boolean",
          description:
            "Set to true to get all spaces including system spaces. Leave empty for user spaces only.",
        },
      },
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
  },
  {
    name: "memory_get_space",
    description:
      "Get detailed information about a specific space including its full summary. USE THIS TOOL: When working on a project to get comprehensive context about that project. The summary contains consolidated knowledge about the space topic. HOW TO USE: Provide either spaceName (like 'core', 'GitHub', 'Profile') OR spaceId (UUID). Returns: Space details with full summary, description, and metadata.",
    inputSchema: {
      type: "object",
      properties: {
        spaceId: {
          type: "string",
          description:
            "UUID of the space (use this if you have the ID from memory_get_spaces)",
        },
        spaceName: {
          type: "string",
          description:
            "Name of the space (easier option). Examples: 'core', 'Profile', 'GitHub', 'Health'",
        },
      },
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
  },
  {
    name: "get_integrations",
    description:
      "List all connected integrations (GitHub, Linear, Slack, etc.). USE THIS TOOL: Before using integration actions to see what's available. WORKFLOW: 1) Call this to see available integrations, 2) Call get_integration_actions with a slug to see what you can do, 3) Call execute_integration_action to do it. Returns: Array with slug, name, accountId, and hasMcp for each integration.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "get_integration_actions",
    description:
      "Get list of actions available for a specific integration. USE THIS TOOL: After get_integrations to see what operations you can perform. For example, GitHub integration has actions like 'get_pr', 'get_issues', 'create_issue'. HOW TO USE: Provide the integrationSlug from get_integrations (like 'github', 'linear', 'slack'). Returns: Array of actions with name, description, and inputSchema for each.",
    inputSchema: {
      type: "object",
      properties: {
        integrationSlug: {
          type: "string",
          description:
            "Slug from get_integrations. Examples: 'github', 'linear', 'slack'",
        },
      },
      required: ["integrationSlug"],
    },
  },
  {
    name: "execute_integration_action",
    description:
      "Execute an action on an integration (fetch GitHub PR, create Linear issue, send Slack message, etc.). USE THIS TOOL: After using get_integration_actions to see available actions. HOW TO USE: 1) Set integrationSlug (like 'github'), 2) Set action name (like 'get_pr'), 3) Set arguments object with required parameters from the action's inputSchema. Returns: Result of the action execution.",
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
        arguments: {
          type: "object",
          description:
            "Parameters for the action. Check the action's inputSchema from get_integration_actions to see what's required.",
        },
      },
      required: ["integrationSlug", "action"],
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
      case "memory_get_spaces":
        return await handleMemoryGetSpaces(userId);
      case "memory_about_user":
        return await handleUserProfile(userId);
      case "memory_get_space":
        return await handleGetSpace({ ...args, userId });
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

// Handler for user_context
async function handleUserProfile(userId: string) {
  try {
    const space = {};

    return {
      content: [
        {
          type: "text",
          text: space?.summary || "No profile information available",
        },
      ],
      isError: false,
    };
  } catch (error) {
    console.error(`Error getting user context:`, error);
    return {
      content: [
        {
          type: "text",
          text: `Error getting user context: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
      isError: true,
    };
  }
}

// Handler for memory_ingest
async function handleMemoryIngest(args: any) {
  try {
    const workspace = await prisma.workspace.findFirst({
      where: {
        userId: args.userId,
      },
    });

    // Check if workspace has sufficient credits before processing
    const hasSufficientCredits = await hasCredits(
      workspace?.id as string,
      "addEpisode",
    );

    if (!hasSufficientCredits) {
      return {
        content: [
          {
            type: "text",
            text: `Error ingesting data: your credits have expired`,
          },
        ],
        isError: true,
      };
    }

    const labelIds =
      args.labelIds || (args.labelId ? [args.labelId] : undefined);

    const response = await addToQueue(
      {
        episodeBody: args.message,
        referenceTime: new Date().toISOString(),
        source: args.source,
        type: EpisodeTypeEnum.CONVERSATION,
        labelIds,
        sessionId: args.sessionId,
      },
      args.userId,
    );
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            success: true,
            id: response.id,
          }),
        },
      ],
    };
  } catch (error) {
    logger.error(`MCP memory ingest error: ${error}`);

    return {
      content: [
        {
          type: "text",
          text: `Error ingesting data: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
      isError: true,
    };
  }
}

// Handler for memory_search
async function handleMemorySearch(args: any) {
  try {
    const labelIds =
      args.labelIds || (args.labelId ? [args.labelId] : undefined);

    const results = await searchService.search(
      args.query,
      args.userId,
      {
        startTime: args.startTime ? new Date(args.startTime) : undefined,
        endTime: args.endTime ? new Date(args.endTime) : undefined,
        labelIds,
        sortBy: args.sortBy as "relevance" | "recency" | undefined,
      },
      args.source,
    );

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(results),
        },
      ],
    };
  } catch (error) {
    logger.error(`MCP memory search error: ${error}`);
    return {
      content: [
        {
          type: "text",
          text: `Error searching memory: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
      isError: true,
    };
  }
}

// Handler for memory_get_spaces
async function handleMemoryGetSpaces(userId: string) {
  try {
    const spaces = await spaceService.getUserSpaces(userId);

    // Return id, name, and description for listing
    const simplifiedSpaces = spaces.map((space) => ({
      id: space.id,
      name: space.name,
    }));

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(simplifiedSpaces),
        },
      ],
      isError: false,
    };
  } catch (error) {
    logger.error(`MCP get spaces error: ${error}`);

    return {
      content: [
        {
          type: "text",
          text: `Error getting spaces: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
      isError: true,
    };
  }
}

// Handler for memory_get_space
async function handleGetSpace(args: any) {
  try {
    const { spaceId, spaceName, userId } = args;

    if (!spaceId && !spaceName) {
      throw new Error("Either spaceId or spaceName is required");
    }

    let space;
    if (spaceName) {
      space = await spaceService.getSpaceByName(spaceName, userId);
    } else {
      space = await spaceService.getSpace(spaceId, userId);
    }

    if (!space) {
      throw new Error(`Space not found: ${spaceName || spaceId}`);
    }

    // Return id, name, description, and summary for detailed view
    const spaceDetails = {
      id: space.id,
      name: space.name,
      summary: space.summary,
    };

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(spaceDetails),
        },
      ],
      isError: false,
    };
  } catch (error) {
    logger.error(`MCP get space error: ${error}`);

    return {
      content: [
        {
          type: "text",
          text: `Error getting space: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
      isError: true,
    };
  }
}

// Handler for get_session_id
async function handleGetSessionId() {
  try {
    const sessionId = randomUUID();

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({ sessionId }),
        },
      ],
      isError: false,
    };
  } catch (error) {
    logger.error(`MCP get session id error: ${error}`);

    return {
      content: [
        {
          type: "text",
          text: `Error generating session ID: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
      isError: true,
    };
  }
}

// Handler for get_integrations
async function handleGetIntegrations(args: any) {
  try {
    const { userId, workspaceId } = args;

    if (!workspaceId) {
      throw new Error("workspaceId is required");
    }

    const integrations =
      await IntegrationLoader.getConnectedIntegrationAccounts(
        userId,
        workspaceId,
      );

    const simplifiedIntegrations = integrations.map((account) => ({
      slug: account.integrationDefinition.slug,
      name: account.integrationDefinition.name,
      accountId: account.id,
      hasMcp: !!account.integrationDefinition.spec?.mcp,
    }));

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(simplifiedIntegrations),
        },
      ],
      isError: false,
    };
  } catch (error) {
    logger.error(`MCP get integrations error: ${error}`);

    return {
      content: [
        {
          type: "text",
          text: `Error getting integrations: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
      isError: true,
    };
  }
}

// Handler for get_integration_actions
async function handleGetIntegrationActions(args: any) {
  try {
    const { integrationSlug, sessionId } = args;

    if (!integrationSlug) {
      throw new Error("integrationSlug is required");
    }

    if (!sessionId) {
      throw new Error("sessionId is required");
    }

    const tools = await IntegrationLoader.getIntegrationTools(
      sessionId,
      integrationSlug,
    );

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(tools),
        },
      ],
      isError: false,
    };
  } catch (error) {
    logger.error(`MCP get integration actions error: ${error}`);

    return {
      content: [
        {
          type: "text",
          text: `Error getting integration actions: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
      isError: true,
    };
  }
}

// Handler for execute_integration_action
async function handleExecuteIntegrationAction(args: any) {
  try {
    const { integrationSlug, action, arguments: actionArgs, sessionId } = args;

    if (!integrationSlug) {
      throw new Error("integrationSlug is required");
    }

    if (!action) {
      throw new Error("action is required");
    }

    if (!sessionId) {
      throw new Error("sessionId is required");
    }

    const toolName = `${integrationSlug}_${action}`;
    const result = await IntegrationLoader.callIntegrationTool(
      sessionId,
      toolName,
      actionArgs || {},
    );

    return result;
  } catch (error) {
    logger.error(`MCP execute integration action error: ${error}`);

    return {
      content: [
        {
          type: "text",
          text: `Error executing integration action: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
      isError: true,
    };
  }
}
