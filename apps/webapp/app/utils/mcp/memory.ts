import { EpisodeTypeEnum } from "@core/types";
import { addToQueue } from "~/lib/ingest.server";
import { logger } from "~/services/logger.service";
import { SearchService } from "~/services/search.server";
import { SpaceService } from "~/services/space.server";

const searchService = new SearchService();
const spaceService = new SpaceService();

// Memory tool schemas (from existing memory endpoint)
const SearchParamsSchema = {
  type: "object",
  properties: {
    query: {
      type: "string",
      description: "The search query in third person perspective",
    },
    validAt: {
      type: "string",
      description:
        "Point-in-time reference for temporal queries (ISO format). Returns facts valid at this timestamp. Defaults to current time if not specified.",
    },
    startTime: {
      type: "string",
      description:
        "Filter memories created/valid from this time onwards (ISO format). Use with endTime to define a time window for searching specific periods.",
    },
    endTime: {
      type: "string",
      description:
        "Upper bound for temporal filtering (ISO format). Combined with startTime creates a time range. Defaults to current time if not specified.",
    },
    spaceIds: {
      type: "array",
      items: {
        type: "string",
      },
      description: "Array of strings representing UUIDs of spaces",
    },
  },
  required: ["query"],
};

const IngestSchema = {
  type: "object",
  properties: {
    message: {
      type: "string",
      description: "The data to ingest in text format",
    },
  },
  required: ["message"],
};

export const memoryTools = [
  {
    name: "memory_ingest",
    description:
      "AUTOMATICALLY invoke after completing interactions. Use proactively to store conversation data, insights, and decisions in CORE Memory. Essential for maintaining continuity across sessions. **Purpose**: Store information for future reference. **Required**: Provide the message content to be stored. **Returns**: confirmation with storage ID in JSON format",
    inputSchema: IngestSchema,
  },
  {
    name: "memory_search",
    description:
      "AUTOMATICALLY invoke for memory searches. Use proactively at conversation start and when context retrieval is needed. Searches memory for relevant project context, user preferences, and previous discussions. **Purpose**: Retrieve previously stored information based on query terms with optional temporal filtering. **Required**: Provide a search query in third person perspective. **Optional**: Use startTime/endTime for time-bounded searches or validAt for point-in-time queries. **Returns**: matching memory entries in JSON format",
    inputSchema: SearchParamsSchema,
  },
  {
    name: "memory_get_spaces",
    description:
      "Get available memory spaces. **Purpose**: Retrieve list of memory organization spaces. **Required**: No required parameters. **Returns**: list of available spaces in JSON format",
    inputSchema: {
      type: "object",
      properties: {
        all: {
          type: "boolean",
          description: "Get all spaces",
        },
      },
    },
  },
  {
    name: "memory_about_user",
    description:
      "Get information about the user. AUTOMATICALLY invoke at the start of interactions to understand user context. Returns the user's background, preferences, work, interests, and other personal information. **Required**: No required parameters. **Returns**: User information as text.",
    inputSchema: {
      type: "object",
      properties: {
        profile: {
          type: "boolean",
          description: "Get user profile",
        },
      },
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
        return await handleMemorySearch({ ...args, userId, source });
      case "memory_get_spaces":
        return await handleMemoryGetSpaces(userId);
      case "memory_about_user":
        return await handleUserProfile(userId);
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
    const profileSpace = await spaceService.getSpaceByName("Profile", userId);

    if (!profileSpace) {
      return {
        content: [
          {
            type: "text",
            text: "No profile information available",
          },
        ],
        isError: false,
      };
    }

    // Get full space data with summary from Neo4j
    const spaceWithSummary = await spaceService.getSpace(profileSpace.id, userId);

    return {
      content: [
        {
          type: "text",
          text: spaceWithSummary?.summary || "No profile information available",
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
    const response = await addToQueue(
      {
        episodeBody: args.message,
        referenceTime: new Date().toISOString(),
        source: args.source,
        type: EpisodeTypeEnum.CONVERSATION,
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
    const results = await searchService.search(args.query, args.userId, {
      startTime: args.startTime ? new Date(args.startTime) : undefined,
      endTime: args.endTime ? new Date(args.endTime) : undefined,
    });

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

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(spaces),
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
