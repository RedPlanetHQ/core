/* eslint-disable @typescript-eslint/no-explicit-any */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import axios, { AxiosInstance } from 'axios';

const GITHUB_MCP_URL = 'https://api.githubcopilot.com/mcp/x/all';

interface MCPTool {
  name: string;
  description?: string;
  inputSchema?: Record<string, any>;
  annotations?: Record<string, any>;
}

interface MCPToolCallResult {
  content: Array<{
    type: string;
    text?: string;
    [key: string]: any;
  }>;
  isError?: boolean;
}

// GitHub API client for custom tools
let githubClient: AxiosInstance;

function initializeGitHubClient(accessToken: string) {
  githubClient = axios.create({
    baseURL: 'https://api.github.com',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });
}

/**
 * Create an MCP client connected to GitHub Copilot MCP server
 */
async function createMCPClient(accessToken: string): Promise<Client> {
  const client = new Client({
    name: 'github-integration',
    version: '1.0.0',
  });

  const transport = new StreamableHTTPClientTransport(new URL(GITHUB_MCP_URL), {
    requestInit: {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
  });

  await client.connect(transport);

  return client;
}

// ============================================================================
// CUSTOM TOOL DEFINITIONS - Milestones (not available in GitHub Copilot MCP)
// ============================================================================

const ListMilestonesSchema = z.object({
  owner: z.string().describe('Repository owner (username or organization)'),
  repo: z.string().describe('Repository name'),
  state: z.enum(['open', 'closed', 'all']).optional().default('open').describe('Milestone state'),
  sort: z.enum(['due_on', 'completeness']).optional().default('due_on').describe('Sort field'),
  direction: z.enum(['asc', 'desc']).optional().default('asc').describe('Sort direction'),
  per_page: z.number().optional().default(30).describe('Results per page (max 100)'),
  page: z.number().optional().default(1).describe('Page number'),
});

const GetMilestoneSchema = z.object({
  owner: z.string().describe('Repository owner'),
  repo: z.string().describe('Repository name'),
  milestone_number: z.number().describe('Milestone number'),
});

const CreateMilestoneSchema = z.object({
  owner: z.string().describe('Repository owner'),
  repo: z.string().describe('Repository name'),
  title: z.string().describe('Milestone title'),
  state: z.enum(['open', 'closed']).optional().default('open').describe('Milestone state'),
  description: z.string().optional().describe('Milestone description'),
  due_on: z
    .string()
    .optional()
    .describe('Due date (ISO 8601 timestamp, e.g., 2024-12-31T23:59:59Z)'),
});

const UpdateMilestoneSchema = z.object({
  owner: z.string().describe('Repository owner'),
  repo: z.string().describe('Repository name'),
  milestone_number: z.number().describe('Milestone number'),
  title: z.string().optional().describe('New milestone title'),
  state: z.enum(['open', 'closed']).optional().describe('Milestone state'),
  description: z.string().optional().describe('Milestone description'),
  due_on: z.string().optional().describe('Due date (ISO 8601 timestamp)'),
});

const DeleteMilestoneSchema = z.object({
  owner: z.string().describe('Repository owner'),
  repo: z.string().describe('Repository name'),
  milestone_number: z.number().describe('Milestone number to delete'),
});

// Custom tools that extend the GitHub Copilot MCP
const customTools: MCPTool[] = [
  {
    name: 'github_list_milestones',
    description: 'List milestones for a repository',
    inputSchema: zodToJsonSchema(ListMilestonesSchema),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
  },
  {
    name: 'github_get_milestone',
    description: 'Get a specific milestone by number',
    inputSchema: zodToJsonSchema(GetMilestoneSchema),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
  },
  {
    name: 'github_create_milestone',
    description: 'Create a new milestone in a repository',
    inputSchema: zodToJsonSchema(CreateMilestoneSchema),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
  },
  {
    name: 'github_update_milestone',
    description: 'Update an existing milestone',
    inputSchema: zodToJsonSchema(UpdateMilestoneSchema),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
  },
  {
    name: 'github_delete_milestone',
    description: 'Delete a milestone from a repository',
    inputSchema: zodToJsonSchema(DeleteMilestoneSchema),
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
  },
];

// Set of custom tool names for routing
const customToolNames = new Set(customTools.map((t) => t.name));

/**
 * Handle custom tool calls that are not available in GitHub Copilot MCP
 */
async function handleCustomToolCall(
  name: string,
  args: Record<string, any>,
  accessToken: string,
): Promise<MCPToolCallResult> {
  initializeGitHubClient(accessToken);

  try {
    switch (name) {
      case 'github_list_milestones': {
        const validatedArgs = ListMilestonesSchema.parse(args);
        const { owner, repo, ...params } = validatedArgs;
        const response = await githubClient.get(`/repos/${owner}/${repo}/milestones`, { params });
        const milestones = response.data || [];

        if (milestones.length === 0) {
          return { content: [{ type: 'text', text: 'No milestones found.' }] };
        }

        const formatted = milestones
          .map(
            (m: any) =>
              `#${m.number}: ${m.title}\nState: ${m.state}\nOpen issues: ${m.open_issues}, Closed: ${m.closed_issues}\nDue: ${m.due_on || 'No due date'}\nURL: ${m.html_url}`,
          )
          .join('\n\n');

        return {
          content: [
            { type: 'text', text: `Found ${milestones.length} milestones:\n\n${formatted}` },
          ],
        };
      }

      case 'github_get_milestone': {
        const validatedArgs = GetMilestoneSchema.parse(args);
        const { owner, repo, milestone_number } = validatedArgs;
        const response = await githubClient.get(
          `/repos/${owner}/${repo}/milestones/${milestone_number}`,
        );
        const m = response.data;

        const progress =
          m.open_issues + m.closed_issues > 0
            ? Math.round((m.closed_issues / (m.open_issues + m.closed_issues)) * 100)
            : 0;

        return {
          content: [
            {
              type: 'text',
              text: `Milestone #${m.number}: ${m.title}\nState: ${m.state}\nDescription: ${m.description || 'No description'}\nProgress: ${progress}% (${m.closed_issues}/${m.open_issues + m.closed_issues} issues closed)\nDue: ${m.due_on || 'No due date'}\nCreated: ${m.created_at}\nURL: ${m.html_url}`,
            },
          ],
        };
      }

      case 'github_create_milestone': {
        const validatedArgs = CreateMilestoneSchema.parse(args);
        const { owner, repo, ...milestoneData } = validatedArgs;
        const response = await githubClient.post(
          `/repos/${owner}/${repo}/milestones`,
          milestoneData,
        );
        const m = response.data;

        return {
          content: [
            {
              type: 'text',
              text: `Milestone created successfully!\n#${m.number}: ${m.title}\nState: ${m.state}\nDue: ${m.due_on || 'No due date'}\nURL: ${m.html_url}`,
            },
          ],
        };
      }

      case 'github_update_milestone': {
        const validatedArgs = UpdateMilestoneSchema.parse(args);
        const { owner, repo, milestone_number, ...updates } = validatedArgs;
        const response = await githubClient.patch(
          `/repos/${owner}/${repo}/milestones/${milestone_number}`,
          updates,
        );
        const m = response.data;

        return {
          content: [
            {
              type: 'text',
              text: `Milestone updated successfully!\n#${m.number}: ${m.title}\nState: ${m.state}\nDue: ${m.due_on || 'No due date'}\nURL: ${m.html_url}`,
            },
          ],
        };
      }

      case 'github_delete_milestone': {
        const validatedArgs = DeleteMilestoneSchema.parse(args);
        const { owner, repo, milestone_number } = validatedArgs;
        await githubClient.delete(`/repos/${owner}/${repo}/milestones/${milestone_number}`);

        return {
          content: [{ type: 'text', text: `Milestone #${milestone_number} deleted successfully.` }],
        };
      }

      default:
        return {
          content: [{ type: 'text', text: `Unknown custom tool: ${name}` }],
          isError: true,
        };
    }
  } catch (error: any) {
    return {
      content: [{ type: 'text', text: `Error: ${error.response?.data?.message || error.message}` }],
      isError: true,
    };
  }
}

/**
 * Get list of available tools from GitHub Copilot MCP server + custom tools
 */
export async function getTools(config?: Record<string, string>): Promise<MCPTool[]> {
  if (!config?.access_token) {
    return customTools;
  }

  let client: Client | null = null;
  let externalTools: MCPTool[] = [];

  try {
    client = await createMCPClient(config.access_token);
    const { tools } = await client.listTools();

    externalTools = tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
      annotations: tool.annotations,
    }));
  } catch (error: any) {
    console.error('Error fetching tools from GitHub Copilot MCP:', error.message);
    // Continue with just custom tools if external MCP fails
  } finally {
    if (client) {
      await client.close();
    }
  }

  // Merge external tools with custom tools (custom tools take precedence for conflicts)
  const externalToolNames = new Set(externalTools.map((t) => t.name));
  const mergedTools = [
    ...externalTools,
    ...customTools.filter((t) => !externalToolNames.has(t.name)),
  ];

  return mergedTools;
}

/**
 * Call a specific tool - routes to external MCP or custom handler
 */
export async function callTool(
  name: string,
  args: Record<string, any>,
  credentials: Record<string, string>,
): Promise<MCPToolCallResult> {
  // Check if this is a custom tool
  if (customToolNames.has(name)) {
    return handleCustomToolCall(name, args, credentials.access_token);
  }

  // Otherwise, route to external MCP
  let client: Client | null = null;

  try {
    client = await createMCPClient(credentials.access_token);

    const result = await client.callTool({
      name,
      arguments: args,
    });

    return {
      content: result.content as MCPToolCallResult['content'],
      isError: result.isError as boolean,
    };
  } catch (error: any) {
    const errorMessage = error.message || 'Unknown error';

    return {
      content: [{ type: 'text', text: `Error calling tool '${name}': ${errorMessage}` }],
      isError: true,
    };
  } finally {
    if (client) {
      await client.close();
    }
  }
}
