import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import axios, { AxiosInstance } from 'axios';

// Linear GraphQL API client
let linearClient: AxiosInstance;

/**
 * Initialize Linear API client with API key
 */
async function initializeLinearClient(apiKey: string) {
  linearClient = axios.create({
    baseURL: 'https://api.linear.app/graphql',
    headers: {
      Authorization: apiKey,
      'Content-Type': 'application/json',
    },
  });
}

/**
 * Execute a GraphQL query against Linear API
 */
async function executeQuery(query: string, variables?: Record<string, any>) {
  try {
    const response = await linearClient.post('', {
      query,
      variables,
    });

    if (response.data.errors) {
      throw new Error(
        `GraphQL errors: ${response.data.errors.map((e: any) => e.message).join(', ')}`
      );
    }

    return response.data.data;
  } catch (error: any) {
    throw new Error(
      `Linear API error: ${error.response?.data?.errors?.[0]?.message || error.message}`
    );
  }
}

// ============================================================================
// SCHEMA DEFINITIONS
// ============================================================================

// Issue Schemas
const CreateIssueSchema = z.object({
  title: z.string().describe('Issue title'),
  description: z.string().optional().describe('Issue description (markdown supported)'),
  teamId: z.string().describe('Team ID where the issue will be created'),
  assigneeId: z.string().optional().describe('User ID to assign the issue to'),
  projectId: z.string().optional().describe('Project ID to add the issue to'),
  priority: z.number().min(0).max(4).optional().describe('Priority (0=None, 1=Urgent, 2=High, 3=Medium, 4=Low)'),
  stateId: z.string().optional().describe('Workflow state ID'),
  labelIds: z.array(z.string()).optional().describe('Array of label IDs to apply'),
  estimate: z.number().optional().describe('Estimate points'),
  dueDate: z.string().optional().describe('Due date (YYYY-MM-DD format)'),
  parentId: z.string().optional().describe('Parent issue ID (for sub-issues)'),
  cycleId: z.string().optional().describe('Cycle ID to add the issue to'),
});

const UpdateIssueSchema = z.object({
  issueId: z.string().describe('Issue ID to update'),
  title: z.string().optional().describe('New title'),
  description: z.string().optional().describe('New description'),
  assigneeId: z.string().optional().describe('New assignee user ID (use null string to unassign)'),
  priority: z.number().min(0).max(4).optional().describe('New priority'),
  stateId: z.string().optional().describe('New workflow state ID'),
  labelIds: z.array(z.string()).optional().describe('New label IDs (replaces existing)'),
  estimate: z.number().optional().describe('New estimate'),
  dueDate: z.string().optional().describe('New due date (YYYY-MM-DD)'),
  projectId: z.string().optional().describe('New project ID'),
  cycleId: z.string().optional().describe('New cycle ID'),
});

const GetIssueSchema = z.object({
  issueId: z.string().describe('Issue ID to retrieve'),
});

const SearchIssuesSchema = z.object({
  query: z.string().optional().describe('Search query text'),
  teamId: z.string().optional().describe('Filter by team ID'),
  assigneeId: z.string().optional().describe('Filter by assignee ID'),
  stateId: z.string().optional().describe('Filter by state ID'),
  projectId: z.string().optional().describe('Filter by project ID'),
  labelId: z.string().optional().describe('Filter by label ID'),
  cycleId: z.string().optional().describe('Filter by cycle ID'),
  first: z.number().optional().default(50).describe('Number of results to return (default: 50)'),
});

const DeleteIssueSchema = z.object({
  issueId: z.string().describe('Issue ID to delete'),
});

// Comment Schemas
const CreateCommentSchema = z.object({
  issueId: z.string().describe('Issue ID to comment on'),
  body: z.string().describe('Comment body (markdown supported)'),
});

const UpdateCommentSchema = z.object({
  commentId: z.string().describe('Comment ID to update'),
  body: z.string().describe('New comment body'),
});

const DeleteCommentSchema = z.object({
  commentId: z.string().describe('Comment ID to delete'),
});

// Project Schemas
const CreateProjectSchema = z.object({
  name: z.string().describe('Project name'),
  description: z.string().optional().describe('Project description'),
  teamIds: z.array(z.string()).describe('Array of team IDs for this project'),
  leadId: z.string().optional().describe('Project lead user ID'),
  startDate: z.string().optional().describe('Start date (YYYY-MM-DD)'),
  targetDate: z.string().optional().describe('Target date (YYYY-MM-DD)'),
  state: z.enum(['planned', 'started', 'paused', 'completed', 'canceled']).optional().describe('Project state'),
});

const UpdateProjectSchema = z.object({
  projectId: z.string().describe('Project ID to update'),
  name: z.string().optional().describe('New name'),
  description: z.string().optional().describe('New description'),
  leadId: z.string().optional().describe('New lead user ID'),
  startDate: z.string().optional().describe('New start date'),
  targetDate: z.string().optional().describe('New target date'),
  state: z.enum(['planned', 'started', 'paused', 'completed', 'canceled']).optional().describe('New state'),
});

const ListProjectsSchema = z.object({
  teamId: z.string().optional().describe('Filter by team ID'),
  first: z.number().optional().default(50).describe('Number of results'),
});

const GetProjectSchema = z.object({
  projectId: z.string().describe('Project ID to retrieve'),
});

// Team Schemas
const ListTeamsSchema = z.object({
  first: z.number().optional().default(50).describe('Number of results'),
});

const GetTeamSchema = z.object({
  teamId: z.string().describe('Team ID to retrieve'),
});

// User Schemas
const ListUsersSchema = z.object({
  first: z.number().optional().default(50).describe('Number of results'),
});

const GetUserSchema = z.object({
  userId: z.string().describe('User ID to retrieve'),
});

const GetViewerSchema = z.object({});

// Workflow State Schemas
const ListWorkflowStatesSchema = z.object({
  teamId: z.string().optional().describe('Filter by team ID'),
  first: z.number().optional().default(50).describe('Number of results'),
});

// Label Schemas
const CreateLabelSchema = z.object({
  name: z.string().describe('Label name'),
  teamId: z.string().describe('Team ID for this label'),
  description: z.string().optional().describe('Label description'),
  color: z.string().optional().describe('Label color (hex format)'),
});

const ListLabelsSchema = z.object({
  teamId: z.string().optional().describe('Filter by team ID'),
  first: z.number().optional().default(50).describe('Number of results'),
});

// Cycle Schemas
const CreateCycleSchema = z.object({
  name: z.string().describe('Cycle name'),
  teamId: z.string().describe('Team ID for this cycle'),
  description: z.string().optional().describe('Cycle description'),
  startsAt: z.string().describe('Start date (ISO 8601 format)'),
  endsAt: z.string().describe('End date (ISO 8601 format)'),
});

const ListCyclesSchema = z.object({
  teamId: z.string().optional().describe('Filter by team ID'),
  first: z.number().optional().default(50).describe('Number of results'),
});

const GetCycleSchema = z.object({
  cycleId: z.string().describe('Cycle ID to retrieve'),
});

// ============================================================================
// TOOL DEFINITIONS
// ============================================================================

export async function getTools() {
  return [
    // Issue Management
    {
      name: 'linear_create_issue',
      description: 'Creates a new issue in Linear',
      inputSchema: zodToJsonSchema(CreateIssueSchema),
    },
    {
      name: 'linear_update_issue',
      description: 'Updates an existing issue',
      inputSchema: zodToJsonSchema(UpdateIssueSchema),
    },
    {
      name: 'linear_get_issue',
      description: 'Gets details of a specific issue',
      inputSchema: zodToJsonSchema(GetIssueSchema),
    },
    {
      name: 'linear_search_issues',
      description: 'Searches for issues with filters',
      inputSchema: zodToJsonSchema(SearchIssuesSchema),
    },
    {
      name: 'linear_delete_issue',
      description: 'Deletes an issue',
      inputSchema: zodToJsonSchema(DeleteIssueSchema),
    },

    // Comment Management
    {
      name: 'linear_create_comment',
      description: 'Creates a comment on an issue',
      inputSchema: zodToJsonSchema(CreateCommentSchema),
    },
    {
      name: 'linear_update_comment',
      description: 'Updates an existing comment',
      inputSchema: zodToJsonSchema(UpdateCommentSchema),
    },
    {
      name: 'linear_delete_comment',
      description: 'Deletes a comment',
      inputSchema: zodToJsonSchema(DeleteCommentSchema),
    },

    // Project Management
    {
      name: 'linear_create_project',
      description: 'Creates a new project',
      inputSchema: zodToJsonSchema(CreateProjectSchema),
    },
    {
      name: 'linear_update_project',
      description: 'Updates an existing project',
      inputSchema: zodToJsonSchema(UpdateProjectSchema),
    },
    {
      name: 'linear_list_projects',
      description: 'Lists all projects',
      inputSchema: zodToJsonSchema(ListProjectsSchema),
    },
    {
      name: 'linear_get_project',
      description: 'Gets details of a specific project',
      inputSchema: zodToJsonSchema(GetProjectSchema),
    },

    // Team Management
    {
      name: 'linear_list_teams',
      description: 'Lists all teams',
      inputSchema: zodToJsonSchema(ListTeamsSchema),
    },
    {
      name: 'linear_get_team',
      description: 'Gets details of a specific team',
      inputSchema: zodToJsonSchema(GetTeamSchema),
    },

    // User Management
    {
      name: 'linear_list_users',
      description: 'Lists all users in the organization',
      inputSchema: zodToJsonSchema(ListUsersSchema),
    },
    {
      name: 'linear_get_user',
      description: 'Gets details of a specific user',
      inputSchema: zodToJsonSchema(GetUserSchema),
    },
    {
      name: 'linear_get_viewer',
      description: 'Gets details of the authenticated user',
      inputSchema: zodToJsonSchema(GetViewerSchema),
    },

    // Workflow States
    {
      name: 'linear_list_workflow_states',
      description: 'Lists all workflow states',
      inputSchema: zodToJsonSchema(ListWorkflowStatesSchema),
    },

    // Labels
    {
      name: 'linear_create_label',
      description: 'Creates a new label',
      inputSchema: zodToJsonSchema(CreateLabelSchema),
    },
    {
      name: 'linear_list_labels',
      description: 'Lists all labels',
      inputSchema: zodToJsonSchema(ListLabelsSchema),
    },

    // Cycles
    {
      name: 'linear_create_cycle',
      description: 'Creates a new cycle',
      inputSchema: zodToJsonSchema(CreateCycleSchema),
    },
    {
      name: 'linear_list_cycles',
      description: 'Lists all cycles',
      inputSchema: zodToJsonSchema(ListCyclesSchema),
    },
    {
      name: 'linear_get_cycle',
      description: 'Gets details of a specific cycle',
      inputSchema: zodToJsonSchema(GetCycleSchema),
    },
  ];
}

// ============================================================================
// TOOL IMPLEMENTATIONS
// ============================================================================

export async function callTool(
  name: string,
  args: Record<string, any>,
  apiKey: string
) {
  // Initialize client if not already done
  if (!linearClient) {
    await initializeLinearClient(apiKey);
  }

  try {
    switch (name) {
      // ====================================================================
      // ISSUE OPERATIONS
      // ====================================================================
      case 'linear_create_issue': {
        const validatedArgs = CreateIssueSchema.parse(args);

        const mutation = `
          mutation CreateIssue($input: IssueCreateInput!) {
            issueCreate(input: $input) {
              success
              issue {
                id
                identifier
                title
                description
                url
                priority
                estimate
                dueDate
                createdAt
                state { id name }
                assignee { id name email }
                team { id name }
                project { id name }
                labels { nodes { id name color } }
              }
            }
          }
        `;

        const input: Record<string, any> = {
          title: validatedArgs.title,
          teamId: validatedArgs.teamId,
        };

        if (validatedArgs.description) input.description = validatedArgs.description;
        if (validatedArgs.assigneeId) input.assigneeId = validatedArgs.assigneeId;
        if (validatedArgs.projectId) input.projectId = validatedArgs.projectId;
        if (validatedArgs.priority !== undefined) input.priority = validatedArgs.priority;
        if (validatedArgs.stateId) input.stateId = validatedArgs.stateId;
        if (validatedArgs.labelIds) input.labelIds = validatedArgs.labelIds;
        if (validatedArgs.estimate) input.estimate = validatedArgs.estimate;
        if (validatedArgs.dueDate) input.dueDate = validatedArgs.dueDate;
        if (validatedArgs.parentId) input.parentId = validatedArgs.parentId;
        if (validatedArgs.cycleId) input.cycleId = validatedArgs.cycleId;

        const data = await executeQuery(mutation, { input });
        const issue = data.issueCreate.issue;

        return {
          content: [{
            type: 'text',
            text: `✓ Issue created: ${issue.identifier} - ${issue.title}\nURL: ${issue.url}\nID: ${issue.id}${issue.assignee ? `\nAssignee: ${issue.assignee.name}` : ''}${issue.state ? `\nState: ${issue.state.name}` : ''}`,
          }],
        };
      }

      case 'linear_update_issue': {
        const validatedArgs = UpdateIssueSchema.parse(args);

        const mutation = `
          mutation UpdateIssue($id: String!, $input: IssueUpdateInput!) {
            issueUpdate(id: $id, input: $input) {
              success
              issue {
                id
                identifier
                title
                description
                url
                priority
                estimate
                dueDate
                updatedAt
                state { id name }
                assignee { id name email }
                project { id name }
                labels { nodes { id name color } }
              }
            }
          }
        `;

        const input: Record<string, any> = {};

        if (validatedArgs.title) input.title = validatedArgs.title;
        if (validatedArgs.description !== undefined) input.description = validatedArgs.description;
        if (validatedArgs.assigneeId !== undefined) input.assigneeId = validatedArgs.assigneeId === 'null' ? null : validatedArgs.assigneeId;
        if (validatedArgs.priority !== undefined) input.priority = validatedArgs.priority;
        if (validatedArgs.stateId) input.stateId = validatedArgs.stateId;
        if (validatedArgs.labelIds) input.labelIds = validatedArgs.labelIds;
        if (validatedArgs.estimate !== undefined) input.estimate = validatedArgs.estimate;
        if (validatedArgs.dueDate !== undefined) input.dueDate = validatedArgs.dueDate;
        if (validatedArgs.projectId !== undefined) input.projectId = validatedArgs.projectId;
        if (validatedArgs.cycleId !== undefined) input.cycleId = validatedArgs.cycleId;

        const data = await executeQuery(mutation, { id: validatedArgs.issueId, input });
        const issue = data.issueUpdate.issue;

        return {
          content: [{
            type: 'text',
            text: `✓ Issue updated: ${issue.identifier} - ${issue.title}\nURL: ${issue.url}`,
          }],
        };
      }

      case 'linear_get_issue': {
        const validatedArgs = GetIssueSchema.parse(args);

        const query = `
          query GetIssue($id: String!) {
            issue(id: $id) {
              id
              identifier
              title
              description
              url
              priority
              estimate
              dueDate
              createdAt
              updatedAt
              state { id name type }
              assignee { id name email }
              creator { id name email }
              team { id name key }
              project { id name }
              cycle { id name }
              parent { id identifier title }
              labels { nodes { id name color } }
              comments { nodes { id body createdAt user { name } } }
            }
          }
        `;

        const data = await executeQuery(query, { id: validatedArgs.issueId });
        const issue = data.issue;

        let text = `Issue: ${issue.identifier} - ${issue.title}\n`;
        text += `URL: ${issue.url}\n`;
        text += `Team: ${issue.team.name} (${issue.team.key})\n`;
        text += `State: ${issue.state.name}\n`;
        if (issue.assignee) text += `Assignee: ${issue.assignee.name} (${issue.assignee.email})\n`;
        if (issue.priority) text += `Priority: ${issue.priority}\n`;
        if (issue.estimate) text += `Estimate: ${issue.estimate}\n`;
        if (issue.dueDate) text += `Due: ${issue.dueDate}\n`;
        if (issue.project) text += `Project: ${issue.project.name}\n`;
        if (issue.cycle) text += `Cycle: ${issue.cycle.name}\n`;
        if (issue.parent) text += `Parent: ${issue.parent.identifier} - ${issue.parent.title}\n`;
        if (issue.labels.nodes.length > 0) {
          text += `Labels: ${issue.labels.nodes.map((l: any) => l.name).join(', ')}\n`;
        }
        text += `\nDescription:\n${issue.description || '(no description)'}\n`;

        if (issue.comments.nodes.length > 0) {
          text += `\nComments (${issue.comments.nodes.length}):\n`;
          issue.comments.nodes.forEach((c: any) => {
            text += `- ${c.user.name}: ${c.body.substring(0, 100)}${c.body.length > 100 ? '...' : ''}\n`;
          });
        }

        return {
          content: [{ type: 'text', text }],
        };
      }

      case 'linear_search_issues': {
        const validatedArgs = SearchIssuesSchema.parse(args);

        let filter: Record<string, any> = {};
        if (validatedArgs.teamId) filter.team = { id: { eq: validatedArgs.teamId } };
        if (validatedArgs.assigneeId) filter.assignee = { id: { eq: validatedArgs.assigneeId } };
        if (validatedArgs.stateId) filter.state = { id: { eq: validatedArgs.stateId } };
        if (validatedArgs.projectId) filter.project = { id: { eq: validatedArgs.projectId } };
        if (validatedArgs.labelId) filter.labels = { some: { id: { eq: validatedArgs.labelId } } };
        if (validatedArgs.cycleId) filter.cycle = { id: { eq: validatedArgs.cycleId } };
        if (validatedArgs.query) filter.searchableContent = { contains: validatedArgs.query };

        const query = `
          query SearchIssues($filter: IssueFilter, $first: Int) {
            issues(filter: $filter, first: $first) {
              nodes {
                id
                identifier
                title
                url
                priority
                createdAt
                updatedAt
                state { name }
                assignee { name }
                team { key }
                project { name }
              }
            }
          }
        `;

        const data = await executeQuery(query, {
          filter: Object.keys(filter).length > 0 ? filter : undefined,
          first: validatedArgs.first,
        });

        const issues = data.issues.nodes;

        if (issues.length === 0) {
          return {
            content: [{ type: 'text', text: 'No issues found matching the criteria.' }],
          };
        }

        let text = `Found ${issues.length} issue(s):\n\n`;
        issues.forEach((issue: any) => {
          text += `${issue.identifier} - ${issue.title}\n`;
          text += `  State: ${issue.state.name}`;
          if (issue.assignee) text += ` | Assignee: ${issue.assignee.name}`;
          if (issue.project) text += ` | Project: ${issue.project.name}`;
          text += `\n  URL: ${issue.url}\n\n`;
        });

        return {
          content: [{ type: 'text', text }],
        };
      }

      case 'linear_delete_issue': {
        const validatedArgs = DeleteIssueSchema.parse(args);

        const mutation = `
          mutation DeleteIssue($id: String!) {
            issueDelete(id: $id) {
              success
            }
          }
        `;

        await executeQuery(mutation, { id: validatedArgs.issueId });

        return {
          content: [{
            type: 'text',
            text: `✓ Issue ${validatedArgs.issueId} deleted successfully`,
          }],
        };
      }

      // ====================================================================
      // COMMENT OPERATIONS
      // ====================================================================
      case 'linear_create_comment': {
        const validatedArgs = CreateCommentSchema.parse(args);

        const mutation = `
          mutation CreateComment($input: CommentCreateInput!) {
            commentCreate(input: $input) {
              success
              comment {
                id
                body
                createdAt
                user { name }
                issue { identifier }
              }
            }
          }
        `;

        const data = await executeQuery(mutation, {
          input: {
            issueId: validatedArgs.issueId,
            body: validatedArgs.body,
          },
        });

        const comment = data.commentCreate.comment;

        return {
          content: [{
            type: 'text',
            text: `✓ Comment added to issue ${comment.issue.identifier}\nBy: ${comment.user.name}\nComment ID: ${comment.id}`,
          }],
        };
      }

      case 'linear_update_comment': {
        const validatedArgs = UpdateCommentSchema.parse(args);

        const mutation = `
          mutation UpdateComment($id: String!, $input: CommentUpdateInput!) {
            commentUpdate(id: $id, input: $input) {
              success
              comment {
                id
                body
                updatedAt
              }
            }
          }
        `;

        const data = await executeQuery(mutation, {
          id: validatedArgs.commentId,
          input: { body: validatedArgs.body },
        });

        return {
          content: [{
            type: 'text',
            text: `✓ Comment ${validatedArgs.commentId} updated successfully`,
          }],
        };
      }

      case 'linear_delete_comment': {
        const validatedArgs = DeleteCommentSchema.parse(args);

        const mutation = `
          mutation DeleteComment($id: String!) {
            commentDelete(id: $id) {
              success
            }
          }
        `;

        await executeQuery(mutation, { id: validatedArgs.commentId });

        return {
          content: [{
            type: 'text',
            text: `✓ Comment ${validatedArgs.commentId} deleted successfully`,
          }],
        };
      }

      // ====================================================================
      // PROJECT OPERATIONS
      // ====================================================================
      case 'linear_create_project': {
        const validatedArgs = CreateProjectSchema.parse(args);

        const mutation = `
          mutation CreateProject($input: ProjectCreateInput!) {
            projectCreate(input: $input) {
              success
              project {
                id
                name
                description
                url
                state
                startDate
                targetDate
                lead { name }
                teams { nodes { name } }
              }
            }
          }
        `;

        const input: Record<string, any> = {
          name: validatedArgs.name,
          teamIds: validatedArgs.teamIds,
        };

        if (validatedArgs.description) input.description = validatedArgs.description;
        if (validatedArgs.leadId) input.leadId = validatedArgs.leadId;
        if (validatedArgs.startDate) input.startDate = validatedArgs.startDate;
        if (validatedArgs.targetDate) input.targetDate = validatedArgs.targetDate;
        if (validatedArgs.state) input.state = validatedArgs.state;

        const data = await executeQuery(mutation, { input });
        const project = data.projectCreate.project;

        return {
          content: [{
            type: 'text',
            text: `✓ Project created: ${project.name}\nURL: ${project.url}\nID: ${project.id}`,
          }],
        };
      }

      case 'linear_update_project': {
        const validatedArgs = UpdateProjectSchema.parse(args);

        const mutation = `
          mutation UpdateProject($id: String!, $input: ProjectUpdateInput!) {
            projectUpdate(id: $id, input: $input) {
              success
              project {
                id
                name
                description
                url
                state
              }
            }
          }
        `;

        const input: Record<string, any> = {};

        if (validatedArgs.name) input.name = validatedArgs.name;
        if (validatedArgs.description !== undefined) input.description = validatedArgs.description;
        if (validatedArgs.leadId) input.leadId = validatedArgs.leadId;
        if (validatedArgs.startDate) input.startDate = validatedArgs.startDate;
        if (validatedArgs.targetDate) input.targetDate = validatedArgs.targetDate;
        if (validatedArgs.state) input.state = validatedArgs.state;

        const data = await executeQuery(mutation, { id: validatedArgs.projectId, input });
        const project = data.projectUpdate.project;

        return {
          content: [{
            type: 'text',
            text: `✓ Project updated: ${project.name}\nURL: ${project.url}`,
          }],
        };
      }

      case 'linear_list_projects': {
        const validatedArgs = ListProjectsSchema.parse(args);

        let filter: Record<string, any> = {};
        if (validatedArgs.teamId) {
          filter.teams = { some: { id: { eq: validatedArgs.teamId } } };
        }

        const query = `
          query ListProjects($filter: ProjectFilter, $first: Int) {
            projects(filter: $filter, first: $first) {
              nodes {
                id
                name
                description
                url
                state
                startDate
                targetDate
                lead { name }
                teams { nodes { name } }
              }
            }
          }
        `;

        const data = await executeQuery(query, {
          filter: Object.keys(filter).length > 0 ? filter : undefined,
          first: validatedArgs.first,
        });

        const projects = data.projects.nodes;

        if (projects.length === 0) {
          return {
            content: [{ type: 'text', text: 'No projects found.' }],
          };
        }

        let text = `Found ${projects.length} project(s):\n\n`;
        projects.forEach((project: any) => {
          text += `${project.name}\n`;
          text += `  State: ${project.state}`;
          if (project.lead) text += ` | Lead: ${project.lead.name}`;
          if (project.targetDate) text += ` | Due: ${project.targetDate}`;
          text += `\n  URL: ${project.url}\n  ID: ${project.id}\n\n`;
        });

        return {
          content: [{ type: 'text', text }],
        };
      }

      case 'linear_get_project': {
        const validatedArgs = GetProjectSchema.parse(args);

        const query = `
          query GetProject($id: String!) {
            project(id: $id) {
              id
              name
              description
              url
              state
              startDate
              targetDate
              progress
              lead { id name email }
              teams { nodes { id name key } }
              issues { nodes { id identifier title state { name } } }
            }
          }
        `;

        const data = await executeQuery(query, { id: validatedArgs.projectId });
        const project = data.project;

        let text = `Project: ${project.name}\n`;
        text += `URL: ${project.url}\n`;
        text += `State: ${project.state}\n`;
        text += `Progress: ${Math.round(project.progress * 100)}%\n`;
        if (project.lead) text += `Lead: ${project.lead.name} (${project.lead.email})\n`;
        if (project.startDate) text += `Start: ${project.startDate}\n`;
        if (project.targetDate) text += `Target: ${project.targetDate}\n`;
        text += `Teams: ${project.teams.nodes.map((t: any) => t.name).join(', ')}\n`;
        text += `\nDescription:\n${project.description || '(no description)'}\n`;
        text += `\nIssues (${project.issues.nodes.length}):\n`;
        project.issues.nodes.slice(0, 10).forEach((issue: any) => {
          text += `- ${issue.identifier}: ${issue.title} [${issue.state.name}]\n`;
        });
        if (project.issues.nodes.length > 10) {
          text += `... and ${project.issues.nodes.length - 10} more\n`;
        }

        return {
          content: [{ type: 'text', text }],
        };
      }

      // ====================================================================
      // TEAM OPERATIONS
      // ====================================================================
      case 'linear_list_teams': {
        const validatedArgs = ListTeamsSchema.parse(args);

        const query = `
          query ListTeams($first: Int) {
            teams(first: $first) {
              nodes {
                id
                name
                key
                description
                private
                states { nodes { id name type } }
              }
            }
          }
        `;

        const data = await executeQuery(query, { first: validatedArgs.first });
        const teams = data.teams.nodes;

        let text = `Found ${teams.length} team(s):\n\n`;
        teams.forEach((team: any) => {
          text += `${team.name} (${team.key})\n`;
          text += `  ID: ${team.id}\n`;
          if (team.description) text += `  Description: ${team.description}\n`;
          text += `  Private: ${team.private ? 'Yes' : 'No'}\n`;
          text += `  States: ${team.states.nodes.length}\n\n`;
        });

        return {
          content: [{ type: 'text', text }],
        };
      }

      case 'linear_get_team': {
        const validatedArgs = GetTeamSchema.parse(args);

        const query = `
          query GetTeam($id: String!) {
            team(id: $id) {
              id
              name
              key
              description
              private
              states { nodes { id name type color } }
              members { nodes { id name email } }
              issues { nodes { id identifier title } }
            }
          }
        `;

        const data = await executeQuery(query, { id: validatedArgs.teamId });
        const team = data.team;

        let text = `Team: ${team.name} (${team.key})\n`;
        text += `ID: ${team.id}\n`;
        if (team.description) text += `Description: ${team.description}\n`;
        text += `Private: ${team.private ? 'Yes' : 'No'}\n`;
        text += `\nMembers (${team.members.nodes.length}):\n`;
        team.members.nodes.forEach((member: any) => {
          text += `- ${member.name} (${member.email})\n`;
        });
        text += `\nWorkflow States (${team.states.nodes.length}):\n`;
        team.states.nodes.forEach((state: any) => {
          text += `- ${state.name} [${state.type}] (ID: ${state.id})\n`;
        });

        return {
          content: [{ type: 'text', text }],
        };
      }

      // ====================================================================
      // USER OPERATIONS
      // ====================================================================
      case 'linear_list_users': {
        const validatedArgs = ListUsersSchema.parse(args);

        const query = `
          query ListUsers($first: Int) {
            users(first: $first) {
              nodes {
                id
                name
                email
                displayName
                active
                admin
              }
            }
          }
        `;

        const data = await executeQuery(query, { first: validatedArgs.first });
        const users = data.users.nodes;

        let text = `Found ${users.length} user(s):\n\n`;
        users.forEach((user: any) => {
          text += `${user.displayName || user.name} (${user.email})\n`;
          text += `  ID: ${user.id}\n`;
          text += `  Active: ${user.active ? 'Yes' : 'No'}`;
          if (user.admin) text += ` | Admin: Yes`;
          text += `\n\n`;
        });

        return {
          content: [{ type: 'text', text }],
        };
      }

      case 'linear_get_user': {
        const validatedArgs = GetUserSchema.parse(args);

        const query = `
          query GetUser($id: String!) {
            user(id: $id) {
              id
              name
              email
              displayName
              active
              admin
              createdAt
              assignedIssues { nodes { id identifier title } }
              createdIssues { nodes { id identifier title } }
            }
          }
        `;

        const data = await executeQuery(query, { id: validatedArgs.userId });
        const user = data.user;

        let text = `User: ${user.displayName || user.name}\n`;
        text += `Email: ${user.email}\n`;
        text += `ID: ${user.id}\n`;
        text += `Active: ${user.active ? 'Yes' : 'No'}\n`;
        if (user.admin) text += `Admin: Yes\n`;
        text += `\nAssigned Issues: ${user.assignedIssues.nodes.length}\n`;
        text += `Created Issues: ${user.createdIssues.nodes.length}\n`;

        return {
          content: [{ type: 'text', text }],
        };
      }

      case 'linear_get_viewer': {
        const query = `
          query GetViewer {
            viewer {
              id
              name
              email
              displayName
              active
              admin
              organization { id name urlKey }
            }
          }
        `;

        const data = await executeQuery(query);
        const viewer = data.viewer;

        let text = `Authenticated User: ${viewer.displayName || viewer.name}\n`;
        text += `Email: ${viewer.email}\n`;
        text += `ID: ${viewer.id}\n`;
        text += `Active: ${viewer.active ? 'Yes' : 'No'}\n`;
        if (viewer.admin) text += `Admin: Yes\n`;
        text += `\nOrganization: ${viewer.organization.name}\n`;
        text += `Organization ID: ${viewer.organization.id}\n`;
        text += `Org URL: https://linear.app/${viewer.organization.urlKey}\n`;

        return {
          content: [{ type: 'text', text }],
        };
      }

      // ====================================================================
      // WORKFLOW STATE OPERATIONS
      // ====================================================================
      case 'linear_list_workflow_states': {
        const validatedArgs = ListWorkflowStatesSchema.parse(args);

        let filter: Record<string, any> = {};
        if (validatedArgs.teamId) {
          filter.team = { id: { eq: validatedArgs.teamId } };
        }

        const query = `
          query ListWorkflowStates($filter: WorkflowStateFilter, $first: Int) {
            workflowStates(filter: $filter, first: $first) {
              nodes {
                id
                name
                type
                color
                description
                team { id name key }
              }
            }
          }
        `;

        const data = await executeQuery(query, {
          filter: Object.keys(filter).length > 0 ? filter : undefined,
          first: validatedArgs.first,
        });

        const states = data.workflowStates.nodes;

        let text = `Found ${states.length} workflow state(s):\n\n`;
        states.forEach((state: any) => {
          text += `${state.name} [${state.type}]\n`;
          text += `  ID: ${state.id}\n`;
          text += `  Team: ${state.team.name} (${state.team.key})\n`;
          if (state.description) text += `  Description: ${state.description}\n`;
          text += `\n`;
        });

        return {
          content: [{ type: 'text', text }],
        };
      }

      // ====================================================================
      // LABEL OPERATIONS
      // ====================================================================
      case 'linear_create_label': {
        const validatedArgs = CreateLabelSchema.parse(args);

        const mutation = `
          mutation CreateLabel($input: IssueLabelCreateInput!) {
            issueLabelCreate(input: $input) {
              success
              issueLabel {
                id
                name
                description
                color
                team { name }
              }
            }
          }
        `;

        const input: Record<string, any> = {
          name: validatedArgs.name,
          teamId: validatedArgs.teamId,
        };

        if (validatedArgs.description) input.description = validatedArgs.description;
        if (validatedArgs.color) input.color = validatedArgs.color;

        const data = await executeQuery(mutation, { input });
        const label = data.issueLabelCreate.issueLabel;

        return {
          content: [{
            type: 'text',
            text: `✓ Label created: ${label.name}\nTeam: ${label.team.name}\nID: ${label.id}`,
          }],
        };
      }

      case 'linear_list_labels': {
        const validatedArgs = ListLabelsSchema.parse(args);

        let filter: Record<string, any> = {};
        if (validatedArgs.teamId) {
          filter.team = { id: { eq: validatedArgs.teamId } };
        }

        const query = `
          query ListLabels($filter: IssueLabelFilter, $first: Int) {
            issueLabels(filter: $filter, first: $first) {
              nodes {
                id
                name
                description
                color
                team { name key }
              }
            }
          }
        `;

        const data = await executeQuery(query, {
          filter: Object.keys(filter).length > 0 ? filter : undefined,
          first: validatedArgs.first,
        });

        const labels = data.issueLabels.nodes;

        if (labels.length === 0) {
          return {
            content: [{ type: 'text', text: 'No labels found.' }],
          };
        }

        let text = `Found ${labels.length} label(s):\n\n`;
        labels.forEach((label: any) => {
          text += `${label.name}\n`;
          text += `  ID: ${label.id}\n`;
          text += `  Team: ${label.team.name} (${label.team.key})\n`;
          if (label.description) text += `  Description: ${label.description}\n`;
          if (label.color) text += `  Color: ${label.color}\n`;
          text += `\n`;
        });

        return {
          content: [{ type: 'text', text }],
        };
      }

      // ====================================================================
      // CYCLE OPERATIONS
      // ====================================================================
      case 'linear_create_cycle': {
        const validatedArgs = CreateCycleSchema.parse(args);

        const mutation = `
          mutation CreateCycle($input: CycleCreateInput!) {
            cycleCreate(input: $input) {
              success
              cycle {
                id
                name
                description
                startsAt
                endsAt
                team { name }
              }
            }
          }
        `;

        const input: Record<string, any> = {
          name: validatedArgs.name,
          teamId: validatedArgs.teamId,
          startsAt: validatedArgs.startsAt,
          endsAt: validatedArgs.endsAt,
        };

        if (validatedArgs.description) input.description = validatedArgs.description;

        const data = await executeQuery(mutation, { input });
        const cycle = data.cycleCreate.cycle;

        return {
          content: [{
            type: 'text',
            text: `✓ Cycle created: ${cycle.name}\nTeam: ${cycle.team.name}\nDuration: ${cycle.startsAt} to ${cycle.endsAt}\nID: ${cycle.id}`,
          }],
        };
      }

      case 'linear_list_cycles': {
        const validatedArgs = ListCyclesSchema.parse(args);

        let filter: Record<string, any> = {};
        if (validatedArgs.teamId) {
          filter.team = { id: { eq: validatedArgs.teamId } };
        }

        const query = `
          query ListCycles($filter: CycleFilter, $first: Int) {
            cycles(filter: $filter, first: $first) {
              nodes {
                id
                name
                description
                startsAt
                endsAt
                progress
                team { name key }
                issues { nodes { id } }
              }
            }
          }
        `;

        const data = await executeQuery(query, {
          filter: Object.keys(filter).length > 0 ? filter : undefined,
          first: validatedArgs.first,
        });

        const cycles = data.cycles.nodes;

        if (cycles.length === 0) {
          return {
            content: [{ type: 'text', text: 'No cycles found.' }],
          };
        }

        let text = `Found ${cycles.length} cycle(s):\n\n`;
        cycles.forEach((cycle: any) => {
          text += `${cycle.name}\n`;
          text += `  ID: ${cycle.id}\n`;
          text += `  Team: ${cycle.team.name} (${cycle.team.key})\n`;
          text += `  Duration: ${cycle.startsAt} to ${cycle.endsAt}\n`;
          text += `  Progress: ${Math.round(cycle.progress * 100)}%\n`;
          text += `  Issues: ${cycle.issues.nodes.length}\n\n`;
        });

        return {
          content: [{ type: 'text', text }],
        };
      }

      case 'linear_get_cycle': {
        const validatedArgs = GetCycleSchema.parse(args);

        const query = `
          query GetCycle($id: String!) {
            cycle(id: $id) {
              id
              name
              description
              startsAt
              endsAt
              progress
              team { name key }
              issues { nodes { id identifier title state { name } } }
            }
          }
        `;

        const data = await executeQuery(query, { id: validatedArgs.cycleId });
        const cycle = data.cycle;

        let text = `Cycle: ${cycle.name}\n`;
        text += `ID: ${cycle.id}\n`;
        text += `Team: ${cycle.team.name} (${cycle.team.key})\n`;
        text += `Duration: ${cycle.startsAt} to ${cycle.endsAt}\n`;
        text += `Progress: ${Math.round(cycle.progress * 100)}%\n`;
        if (cycle.description) text += `\nDescription:\n${cycle.description}\n`;
        text += `\nIssues (${cycle.issues.nodes.length}):\n`;
        cycle.issues.nodes.forEach((issue: any) => {
          text += `- ${issue.identifier}: ${issue.title} [${issue.state.name}]\n`;
        });

        return {
          content: [{ type: 'text', text }],
        };
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error: any) {
    return {
      content: [{
        type: 'text',
        text: `Error: ${error.message}`,
      }],
    };
  }
}
