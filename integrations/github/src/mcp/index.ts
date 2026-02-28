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

// Empty Schema for get_me
const EmptySchema = z.object({});

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

// Issue Template Schemas
const ListIssueTemplatesSchema = z.object({
  owner: z.string().describe('Repository owner'),
  repo: z.string().describe('Repository name'),
});

const GetIssueTemplateSchema = z.object({
  owner: z.string().describe('Repository owner'),
  repo: z.string().describe('Repository name'),
  filename: z.string().describe('Template filename (e.g., bug_report.yml)'),
});

const CreateIssueFromTemplateSchema = z.object({
  owner: z.string().describe('Repository owner'),
  repo: z.string().describe('Repository name'),
  filename: z.string().describe('Template filename'),
  field_values: z.record(z.string(), z.any()).describe('Values for template fields'),
  title_override: z.string().optional().describe('Override the issue title'),
  labels_override: z.array(z.string()).optional().describe('Override/add labels'),
});

// Custom tools that extend the GitHub Copilot MCP
const customTools: MCPTool[] = [
  {
    name: 'github_get_me',
    description: 'Get information about the currently authenticated user',
    inputSchema: zodToJsonSchema(EmptySchema),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
  },
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
  {
    name: 'github_list_issue_templates',
    description: 'Discover issue templates in a repository (.github/ISSUE_TEMPLATE)',
    inputSchema: zodToJsonSchema(ListIssueTemplatesSchema),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
  },
  {
    name: 'github_get_issue_template',
    description: 'Get and parse a specific issue template',
    inputSchema: zodToJsonSchema(GetIssueTemplateSchema),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
  },
  {
    name: 'github_create_issue_from_template',
    description: 'Create an issue using a template with field values',
    inputSchema: zodToJsonSchema(CreateIssueFromTemplateSchema),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
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

      case 'github_list_issue_templates': {
        const { owner, repo } = ListIssueTemplatesSchema.parse(args);
        // Look in .github/ISSUE_TEMPLATE
        try {
          const response = await githubClient.get(
            `/repos/${owner}/${repo}/contents/.github/ISSUE_TEMPLATE`,
          );
          const files = response.data || [];

          const templates = files
            .filter(
              (f: any) =>
                f.name.endsWith('.yml') || f.name.endsWith('.yaml') || f.name.endsWith('.md'),
            )
            .map((f: any) => `- ${f.name} (Type: ${f.name.endsWith('.md') ? 'Markdown' : 'YAML'})`)
            .join('\n');

          return {
            content: [
              {
                type: 'text',
                text: `Issue templates in ${owner}/${repo}:\n\n${templates || 'No templates found.'}`,
              },
            ],
          };
        } catch (error: any) {
          if (error.response?.status === 404) {
            return {
              content: [
                { type: 'text', text: 'No issue templates found in .github/ISSUE_TEMPLATE.' },
              ],
            };
          }
          throw error;
        }
      }

      case 'github_get_issue_template': {
        const { owner, repo, filename } = GetIssueTemplateSchema.parse(args);
        const response = await githubClient.get(
          `/repos/${owner}/${repo}/contents/.github/ISSUE_TEMPLATE/${filename}`,
        );
        const content = Buffer.from(response.data.content, 'base64').toString('utf8');

        return {
          content: [{ type: 'text', text: `Template: ${filename}\n\n\`\`\`\n${content}\n\`\`\`` }],
        };
      }

      case 'github_create_issue_from_template': {
        const { owner, repo, filename, field_values, title_override, labels_override } =
          CreateIssueFromTemplateSchema.parse(args);

        // 1. Get the template to parse metadata
        const response = await githubClient.get(
          `/repos/${owner}/${repo}/contents/.github/ISSUE_TEMPLATE/${filename}`,
        );
        const rawContent = Buffer.from(response.data.content, 'base64').toString('utf8');

        // Simple YAML/Metadata extraction (for labels/assignees/title)
        const labels: string[] = [...(labels_override || [])];
        let title = title_override || 'Issue from template';

        if (filename.endsWith('.yml') || filename.endsWith('.yaml')) {
          // Parse labels from YAML (very simple regex-based for now)
          const labelMatch = rawContent.match(/labels:\s*\[(.*?)\]/);
          if (labelMatch) {
            const templateLabels = labelMatch[1]
              .split(',')
              .map((l) => l.trim().replace(/['"]/g, ''));
            labels.push(...templateLabels);
          }
          const nameMatch = rawContent.match(/^name:\s*(.*)$/m);
          if (nameMatch && !title_override) title = nameMatch[1].trim().replace(/['"]/g, '');
        }

        // 2. Construct body from field values
        let body = `### Generated from template: ${filename}\n\n`;
        for (const [key, value] of Object.entries(field_values)) {
          body += `#### ${key}\n${value}\n\n`;
        }

        // 3. Create the issue
        const createResponse = await githubClient.post(`/repos/${owner}/${repo}/issues`, {
          title,
          body,
          labels: [...new Set(labels)],
        });

        return {
          content: [
            {
              type: 'text',
              text: `Issue created successfully from template: #${createResponse.data.number}\nURL: ${createResponse.data.html_url}`,
            },
          ],
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
