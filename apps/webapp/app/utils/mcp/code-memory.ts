import { logger } from "~/services/logger.service";
import { listRepositories } from "~/services/graphModels/repository";
import { searchCodeFiles } from "~/services/graphModels/codeFile";
import { searchFunctions, getFunctionCalls, getFunctionCallers } from "~/services/graphModels/function";
import { searchClasses, getParentClass, getChildClasses } from "~/services/graphModels/class";
import { searchReviews, getFileReviews, getFunctionReviews, getClassReviews } from "~/services/graphModels/aiReview";

// Code memory tool schemas
const CodeSearchSchema = {
  type: "object",
  properties: {
    query: {
      type: "string",
      description: "Search query for code entities (function names, class names, file paths)",
    },
    type: {
      type: "string",
      enum: ["function", "class", "file", "all"],
      description: "Type of code entity to search for. Defaults to 'all'",
    },
    limit: {
      type: "number",
      description: "Maximum number of results to return. Defaults to 20",
    },
  },
  required: ["query"],
};

const CodeHistorySchema = {
  type: "object",
  properties: {
    filePath: {
      type: "string",
      description: "Path to the file to get history for",
    },
    entityName: {
      type: "string",
      description: "Name of function or class to track changes for",
    },
  },
  required: ["filePath"],
};

const AIReviewedCodeSchema = {
  type: "object",
  properties: {
    author: {
      type: "string",
      description: "Filter by AI author (e.g., 'Claude', 'GitHub Copilot')",
    },
    repository: {
      type: "string",
      description: "Filter by repository name",
    },
    limit: {
      type: "number",
      description: "Maximum number of results. Defaults to 20",
    },
  },
};

const CodeDependenciesSchema = {
  type: "object",
  properties: {
    entityName: {
      type: "string",
      description: "Name of function or class to get dependencies for",
    },
    entityType: {
      type: "string",
      enum: ["function", "class"],
      description: "Type of entity",
    },
    direction: {
      type: "string",
      enum: ["incoming", "outgoing", "both"],
      description: "Direction of dependencies. 'incoming' shows what depends on this, 'outgoing' shows what this depends on",
    },
  },
  required: ["entityName", "entityType"],
};

export const codeMemoryTools = [
  {
    name: "code_search",
    description:
      "Search code entities (functions, classes, files) in connected GitHub repositories. **Purpose**: Find code by name or path. **Required**: query string. **Optional**: type filter (function/class/file), limit. **Returns**: matching code entities with location info",
    inputSchema: CodeSearchSchema,
  },
  {
    name: "code_history",
    description:
      "Track changes to code over time. **Purpose**: View modification history of files and code entities. **Required**: filePath. **Optional**: entityName for specific function/class. **Returns**: change history with timestamps",
    inputSchema: CodeHistorySchema,
  },
  {
    name: "ai_reviewed_code",
    description:
      "Find code that has been reviewed by AI assistants. **Purpose**: Discover AI feedback on code. **Optional**: author (AI name), repository filter, limit. **Returns**: AI reviews with comments and locations",
    inputSchema: AIReviewedCodeSchema,
  },
  {
    name: "code_dependencies",
    description:
      "Map code dependencies and relationships. **Purpose**: Understand function calls, class inheritance, and imports. **Required**: entityName, entityType. **Optional**: direction (incoming/outgoing/both). **Returns**: dependency graph with relationships",
    inputSchema: CodeDependenciesSchema,
  },
];

/**
 * Call code memory tools
 */
export async function callCodeMemoryTool(
  toolName: string,
  args: Record<string, any>,
  userId: string,
  workspaceId: string
): Promise<any> {
  logger.log(`Calling code memory tool: ${toolName}`, args);

  switch (toolName) {
    case "code_search":
      return await handleCodeSearch(args, userId, workspaceId);

    case "code_history":
      return await handleCodeHistory(args, userId, workspaceId);

    case "ai_reviewed_code":
      return await handleAIReviewedCode(args, userId, workspaceId);

    case "code_dependencies":
      return await handleCodeDependencies(args, userId, workspaceId);

    default:
      throw new Error(`Unknown code memory tool: ${toolName}`);
  }
}

/**
 * Handle code_search tool
 */
async function handleCodeSearch(
  args: { query: string; type?: string; limit?: number },
  userId: string,
  workspaceId: string
) {
  const { query, type = "all", limit = 20 } = args;
  const results: any = {
    query,
    results: {
      files: [],
      functions: [],
      classes: [],
    },
    totalResults: 0,
  };

  // Search files
  if (type === "file" || type === "all") {
    const files = await searchCodeFiles(query, userId, workspaceId, limit);
    results.results.files = files.map((file) => ({
      path: file.path,
      language: file.language,
      branch: file.branch,
      lastModified: file.modifiedAt,
    }));
  }

  // Search functions
  if (type === "function" || type === "all") {
    const functions = await searchFunctions(query, userId, workspaceId, limit);
    results.results.functions = functions.map((func) => ({
      name: func.name,
      params: func.params,
      returnType: func.returnType,
      location: {
        startLine: func.startLine,
        endLine: func.endLine,
      },
      isAsync: func.isAsync,
      isExport: func.isExport,
    }));
  }

  // Search classes
  if (type === "class" || type === "all") {
    const classes = await searchClasses(query, userId, workspaceId, limit);
    results.results.classes = classes.map((cls) => ({
      name: cls.name,
      extends: cls.extends,
      methods: cls.methods,
      properties: cls.properties,
      location: {
        startLine: cls.startLine,
        endLine: cls.endLine,
      },
      isExport: cls.isExport,
    }));
  }

  results.totalResults =
    results.results.files.length +
    results.results.functions.length +
    results.results.classes.length;

  return results;
}

/**
 * Handle code_history tool
 */
async function handleCodeHistory(
  args: { filePath: string; entityName?: string },
  userId: string,
  workspaceId: string
) {
  const { filePath, entityName } = args;

  // Get file versions
  const files = await searchCodeFiles(filePath, userId, workspaceId, 10);

  const history = {
    filePath,
    entityName,
    versions: files.map((file) => ({
      commitSha: file.commitSha,
      branch: file.branch,
      modifiedAt: file.modifiedAt,
      deletedAt: file.deletedAt,
    })),
  };

  return history;
}

/**
 * Handle ai_reviewed_code tool
 */
async function handleAIReviewedCode(
  args: { author?: string; repository?: string; limit?: number },
  userId: string,
  workspaceId: string
) {
  const { author, repository, limit = 20 } = args;

  const reviews = await searchReviews({
    author,
    repository,
    userId,
    workspaceId,
    limit,
  });

  return {
    reviews: reviews.map((review) => ({
      author: review.author,
      service: review.service,
      comment: review.commentBody,
      location: {
        repository: review.repository,
        filePath: review.filePath,
        lineNumber: review.lineNumber,
        prNumber: review.prNumber,
      },
      url: review.commentUrl,
      createdAt: review.createdAt,
    })),
    totalReviews: reviews.length,
  };
}

/**
 * Handle code_dependencies tool
 */
async function handleCodeDependencies(
  args: { entityName: string; entityType: string; direction?: string },
  userId: string,
  workspaceId: string
) {
  const { entityName, entityType, direction = "both" } = args;

  if (entityType === "function") {
    // Search for the function first
    const functions = await searchFunctions(entityName, userId, workspaceId, 1);

    if (functions.length === 0) {
      return {
        entityName,
        entityType,
        error: "Function not found",
      };
    }

    const func = functions[0];
    const dependencies: any = {
      entityName,
      entityType,
      incoming: [],
      outgoing: [],
    };

    // Get outgoing dependencies (what this function calls)
    if (direction === "outgoing" || direction === "both") {
      const calls = await getFunctionCalls(func.uuid, userId, workspaceId);
      dependencies.outgoing = calls.map((c) => ({
        name: c.name,
        type: "function",
        relationship: "calls",
      }));
    }

    // Get incoming dependencies (what calls this function)
    if (direction === "incoming" || direction === "both") {
      const callers = await getFunctionCallers(func.uuid, userId, workspaceId);
      dependencies.incoming = callers.map((c) => ({
        name: c.name,
        type: "function",
        relationship: "called_by",
      }));
    }

    return dependencies;
  } else if (entityType === "class") {
    // Search for the class first
    const classes = await searchClasses(entityName, userId, workspaceId, 1);

    if (classes.length === 0) {
      return {
        entityName,
        entityType,
        error: "Class not found",
      };
    }

    const cls = classes[0];
    const dependencies: any = {
      entityName,
      entityType,
      incoming: [],
      outgoing: [],
    };

    // Get parent class (what this class extends)
    if (direction === "outgoing" || direction === "both") {
      const parent = await getParentClass(cls.uuid, userId, workspaceId);
      if (parent) {
        dependencies.outgoing = [
          {
            name: parent.name,
            type: "class",
            relationship: "extends",
          },
        ];
      }
    }

    // Get child classes (what extends this class)
    if (direction === "incoming" || direction === "both") {
      const children = await getChildClasses(cls.uuid, userId, workspaceId);
      dependencies.incoming = children.map((c) => ({
        name: c.name,
        type: "class",
        relationship: "extended_by",
      }));
    }

    return dependencies;
  }

  return {
    entityName,
    entityType,
    error: "Invalid entity type",
  };
}
