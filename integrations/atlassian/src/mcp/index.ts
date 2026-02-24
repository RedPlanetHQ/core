/* eslint-disable @typescript-eslint/no-explicit-any */
import axios, { AxiosInstance } from 'axios';
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';

import { getAuthHeaders } from '../utils';

let jiraClient: AxiosInstance;
let confluenceClient: AxiosInstance;

function initializeClients(config: Record<string, string>) {
  const headers = getAuthHeaders(config.access_token);
  const cloudId = config.cloud_id;

  jiraClient = axios.create({
    baseURL: `https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3`,
    headers,
  });

  confluenceClient = axios.create({
    baseURL: `https://api.atlassian.com/ex/confluence/${cloudId}/wiki/api/v2`,
    headers,
  });
}

// ─── Jira Schemas ──────────────────────────────────────────────────────────

const JiraSearchIssuesSchema = z.object({
  jql: z.string().describe('JQL query string (e.g. "project = PROJ AND status = Open")'),
  maxResults: z.number().optional().default(20).describe('Max results to return (default 20, max 100)'),
  startAt: z.number().optional().default(0).describe('Index of the first result to return'),
  fields: z
    .array(z.string())
    .optional()
    .describe('List of fields to return (e.g. ["summary", "status", "assignee"]). Defaults to navigable fields.'),
});

const JiraGetIssueSchema = z.object({
  issue_key: z.string().describe('Issue key (e.g. "PROJ-123") or issue ID'),
});

const JiraCreateIssueSchema = z.object({
  project_key: z.string().describe('Project key (e.g. "PROJ")'),
  issue_type: z.string().describe('Issue type name (e.g. "Task", "Bug", "Story")'),
  summary: z.string().describe('Issue summary/title'),
  description: z.string().optional().describe('Issue description (plain text, will be converted to ADF)'),
  assignee_id: z.string().optional().describe('Atlassian account ID of the assignee'),
  priority: z.string().optional().describe('Priority name (e.g. "High", "Medium", "Low")'),
  labels: z.array(z.string()).optional().describe('Array of label strings'),
});

const JiraUpdateIssueSchema = z.object({
  issue_key: z.string().describe('Issue key (e.g. "PROJ-123") or issue ID'),
  summary: z.string().optional().describe('New summary/title'),
  description: z.string().optional().describe('New description (plain text, will be converted to ADF)'),
  assignee_id: z.string().optional().describe('Atlassian account ID of the new assignee'),
  priority: z.string().optional().describe('New priority name'),
  labels: z.array(z.string()).optional().describe('Replacement labels array'),
});

const JiraAddCommentSchema = z.object({
  issue_key: z.string().describe('Issue key (e.g. "PROJ-123") or issue ID'),
  body: z.string().describe('Comment text (plain text, will be converted to ADF)'),
});

const JiraListProjectsSchema = z.object({
  maxResults: z.number().optional().default(50).describe('Max projects to return'),
  startAt: z.number().optional().default(0).describe('Index of the first result'),
});

const JiraGetTransitionsSchema = z.object({
  issue_key: z.string().describe('Issue key (e.g. "PROJ-123") or issue ID'),
});

const JiraTransitionIssueSchema = z.object({
  issue_key: z.string().describe('Issue key (e.g. "PROJ-123") or issue ID'),
  transition_id: z.string().describe('Transition ID (get available IDs from jira_get_transitions)'),
  comment: z.string().optional().describe('Optional comment to add with the transition'),
});

// ─── Confluence Schemas ────────────────────────────────────────────────────

const ConfluenceSearchSchema = z.object({
  cql: z.string().describe('CQL query string (e.g. "type = page AND space = DEV AND text ~ search term")'),
  limit: z.number().optional().default(20).describe('Max results to return (default 20)'),
  start: z.number().optional().default(0).describe('Index of the first result'),
});

const ConfluenceGetPageSchema = z.object({
  page_id: z.string().describe('The ID of the Confluence page'),
  body_format: z
    .enum(['storage', 'atlas_doc_format', 'view'])
    .optional()
    .default('storage')
    .describe('Format for page body content'),
});

const ConfluenceCreatePageSchema = z.object({
  space_id: z.string().describe('The ID of the space to create the page in'),
  title: z.string().describe('Page title'),
  body: z.string().optional().describe('Page body in storage format (XHTML)'),
  parent_id: z.string().optional().describe('Parent page ID (for nested pages)'),
  status: z
    .enum(['current', 'draft'])
    .optional()
    .default('current')
    .describe('Page status'),
});

const ConfluenceUpdatePageSchema = z.object({
  page_id: z.string().describe('The ID of the page to update'),
  title: z.string().describe('Page title (required even if unchanged)'),
  body: z.string().optional().describe('New page body in storage format (XHTML)'),
  version_number: z.number().describe('New version number (current version + 1)'),
  status: z
    .enum(['current', 'draft'])
    .optional()
    .default('current')
    .describe('Page status'),
});

const ConfluenceListSpacesSchema = z.object({
  limit: z.number().optional().default(25).describe('Max spaces to return'),
  start: z.number().optional().default(0).describe('Index of the first result'),
  type: z
    .enum(['global', 'personal'])
    .optional()
    .describe('Filter by space type'),
});

// ─── Tool Definitions ──────────────────────────────────────────────────────

export async function getTools() {
  return [
    // Jira tools
    {
      name: 'jira_search_issues',
      description: 'Search Jira issues using JQL (Jira Query Language).',
      inputSchema: zodToJsonSchema(JiraSearchIssuesSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'jira_get_issue',
      description: 'Get detailed information about a single Jira issue by its key or ID.',
      inputSchema: zodToJsonSchema(JiraGetIssueSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'jira_create_issue',
      description: 'Create a new Jira issue in a project.',
      inputSchema: zodToJsonSchema(JiraCreateIssueSchema),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    {
      name: 'jira_update_issue',
      description: 'Update fields on an existing Jira issue.',
      inputSchema: zodToJsonSchema(JiraUpdateIssueSchema),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'jira_add_comment',
      description: 'Add a comment to a Jira issue.',
      inputSchema: zodToJsonSchema(JiraAddCommentSchema),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    {
      name: 'jira_list_projects',
      description: 'List Jira projects accessible to the authenticated user.',
      inputSchema: zodToJsonSchema(JiraListProjectsSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'jira_get_transitions',
      description: 'Get available status transitions for a Jira issue.',
      inputSchema: zodToJsonSchema(JiraGetTransitionsSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'jira_transition_issue',
      description: 'Transition a Jira issue to a new status (e.g. move from "To Do" to "In Progress").',
      inputSchema: zodToJsonSchema(JiraTransitionIssueSchema),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    // Confluence tools
    {
      name: 'confluence_search',
      description: 'Search Confluence content using CQL (Confluence Query Language).',
      inputSchema: zodToJsonSchema(ConfluenceSearchSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'confluence_get_page',
      description: 'Get a Confluence page by its ID, including body content.',
      inputSchema: zodToJsonSchema(ConfluenceGetPageSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'confluence_create_page',
      description: 'Create a new Confluence page in a space.',
      inputSchema: zodToJsonSchema(ConfluenceCreatePageSchema),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    {
      name: 'confluence_update_page',
      description: 'Update an existing Confluence page. Requires the new version number.',
      inputSchema: zodToJsonSchema(ConfluenceUpdatePageSchema),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'confluence_list_spaces',
      description: 'List Confluence spaces accessible to the authenticated user.',
      inputSchema: zodToJsonSchema(ConfluenceListSpacesSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
  ];
}

// ─── Helpers ───────────────────────────────────────────────────────────────

/**
 * Convert plain text to Atlassian Document Format (ADF).
 * Jira v3 API requires ADF for description and comment bodies.
 */
function textToAdf(text: string) {
  return {
    type: 'doc',
    version: 1,
    content: text.split('\n').map((line) => ({
      type: 'paragraph',
      content: line ? [{ type: 'text', text: line }] : [],
    })),
  };
}

// ─── Tool Dispatcher ───────────────────────────────────────────────────────

export async function callTool(
  name: string,
  args: Record<string, any>,
  config: Record<string, string>,
) {
  initializeClients(config);

  try {
    switch (name) {
      // ── Jira Tools ─────────────────────────────────────────────────────

      case 'jira_search_issues': {
        const { jql, maxResults, startAt, fields } = JiraSearchIssuesSchema.parse(args);
        const params: Record<string, any> = { jql, maxResults, startAt };
        if (fields) params.fields = fields.join(',');

        const response = await jiraClient.get('/search', { params });
        const issues = response.data.issues || [];
        const total = response.data.total;

        if (issues.length === 0) {
          return { content: [{ type: 'text', text: 'No issues found.' }] };
        }

        const list = issues
          .map(
            (i: any) =>
              `Key: ${i.key}\nSummary: ${i.fields.summary}\nStatus: ${i.fields.status?.name || 'N/A'}\nAssignee: ${i.fields.assignee?.displayName || 'Unassigned'}\nPriority: ${i.fields.priority?.name || 'N/A'}\nType: ${i.fields.issuetype?.name || 'N/A'}`,
          )
          .join('\n\n');

        return {
          content: [
            {
              type: 'text',
              text: `Found ${issues.length} of ${total} issues:\n\n${list}`,
            },
          ],
        };
      }

      case 'jira_get_issue': {
        const { issue_key } = JiraGetIssueSchema.parse(args);
        const response = await jiraClient.get(`/issue/${issue_key}`);
        const i = response.data;
        const f = i.fields;

        const labels = f.labels?.length ? f.labels.join(', ') : 'None';
        const components = f.components?.map((c: any) => c.name).join(', ') || 'None';

        return {
          content: [
            {
              type: 'text',
              text: `Issue: ${i.key}\nSummary: ${f.summary}\nStatus: ${f.status?.name || 'N/A'}\nType: ${f.issuetype?.name || 'N/A'}\nPriority: ${f.priority?.name || 'N/A'}\nAssignee: ${f.assignee?.displayName || 'Unassigned'}\nReporter: ${f.reporter?.displayName || 'N/A'}\nLabels: ${labels}\nComponents: ${components}\nCreated: ${f.created}\nUpdated: ${f.updated}\nDescription: ${f.description ? JSON.stringify(f.description) : 'N/A'}`,
            },
          ],
        };
      }

      case 'jira_create_issue': {
        const { project_key, issue_type, summary, description, assignee_id, priority, labels } =
          JiraCreateIssueSchema.parse(args);

        const fields: Record<string, any> = {
          project: { key: project_key },
          issuetype: { name: issue_type },
          summary,
        };

        if (description) fields.description = textToAdf(description);
        if (assignee_id) fields.assignee = { accountId: assignee_id };
        if (priority) fields.priority = { name: priority };
        if (labels) fields.labels = labels;

        const response = await jiraClient.post('/issue', { fields });
        const created = response.data;

        return {
          content: [
            {
              type: 'text',
              text: `Issue created!\nKey: ${created.key}\nID: ${created.id}\nURL: ${config.site_url}/browse/${created.key}`,
            },
          ],
        };
      }

      case 'jira_update_issue': {
        const { issue_key, summary, description, assignee_id, priority, labels } =
          JiraUpdateIssueSchema.parse(args);

        const fields: Record<string, any> = {};
        if (summary) fields.summary = summary;
        if (description) fields.description = textToAdf(description);
        if (assignee_id) fields.assignee = { accountId: assignee_id };
        if (priority) fields.priority = { name: priority };
        if (labels) fields.labels = labels;

        await jiraClient.put(`/issue/${issue_key}`, { fields });

        return {
          content: [
            {
              type: 'text',
              text: `Issue ${issue_key} updated successfully.`,
            },
          ],
        };
      }

      case 'jira_add_comment': {
        const { issue_key, body } = JiraAddCommentSchema.parse(args);

        const response = await jiraClient.post(`/issue/${issue_key}/comment`, {
          body: textToAdf(body),
        });

        return {
          content: [
            {
              type: 'text',
              text: `Comment added to ${issue_key}.\nComment ID: ${response.data.id}`,
            },
          ],
        };
      }

      case 'jira_list_projects': {
        const { maxResults, startAt } = JiraListProjectsSchema.parse(args);
        const response = await jiraClient.get('/project/search', {
          params: { maxResults, startAt },
        });

        const projects = response.data.values || [];
        const total = response.data.total;

        if (projects.length === 0) {
          return { content: [{ type: 'text', text: 'No projects found.' }] };
        }

        const list = projects
          .map(
            (p: any) =>
              `Key: ${p.key}\nName: ${p.name}\nType: ${p.projectTypeKey}\nStyle: ${p.style || 'N/A'}\nLead: ${p.lead?.displayName || 'N/A'}`,
          )
          .join('\n\n');

        return {
          content: [
            {
              type: 'text',
              text: `Found ${projects.length} of ${total} projects:\n\n${list}`,
            },
          ],
        };
      }

      case 'jira_get_transitions': {
        const { issue_key } = JiraGetTransitionsSchema.parse(args);
        const response = await jiraClient.get(`/issue/${issue_key}/transitions`);
        const transitions = response.data.transitions || [];

        if (transitions.length === 0) {
          return { content: [{ type: 'text', text: `No transitions available for ${issue_key}.` }] };
        }

        const list = transitions
          .map(
            (t: any) =>
              `ID: ${t.id}\nName: ${t.name}\nTo: ${t.to?.name || 'N/A'}`,
          )
          .join('\n\n');

        return {
          content: [
            {
              type: 'text',
              text: `Available transitions for ${issue_key}:\n\n${list}`,
            },
          ],
        };
      }

      case 'jira_transition_issue': {
        const { issue_key, transition_id, comment } = JiraTransitionIssueSchema.parse(args);

        const body: Record<string, any> = {
          transition: { id: transition_id },
        };

        if (comment) {
          body.update = {
            comment: [
              {
                add: { body: textToAdf(comment) },
              },
            ],
          };
        }

        await jiraClient.post(`/issue/${issue_key}/transitions`, body);

        return {
          content: [
            {
              type: 'text',
              text: `Issue ${issue_key} transitioned successfully.`,
            },
          ],
        };
      }

      // ── Confluence Tools ───────────────────────────────────────────────

      case 'confluence_search': {
        const { cql, limit, start } = ConfluenceSearchSchema.parse(args);
        const response = await confluenceClient.get('/search', {
          params: { cql, limit, start },
        });

        const results = response.data.results || [];

        if (results.length === 0) {
          return { content: [{ type: 'text', text: 'No results found.' }] };
        }

        const list = results
          .map((r: any) => {
            const content = r.content || r;
            return `ID: ${content.id}\nTitle: ${content.title}\nType: ${content.type || 'N/A'}\nStatus: ${content.status || 'N/A'}`;
          })
          .join('\n\n');

        return {
          content: [
            {
              type: 'text',
              text: `Found ${results.length} results:\n\n${list}`,
            },
          ],
        };
      }

      case 'confluence_get_page': {
        const { page_id, body_format } = ConfluenceGetPageSchema.parse(args);
        const response = await confluenceClient.get(`/pages/${page_id}`, {
          params: { 'body-format': body_format },
        });

        const page = response.data;
        const body = page.body?.[body_format]?.value || 'No content';

        return {
          content: [
            {
              type: 'text',
              text: `Page: ${page.title}\nID: ${page.id}\nStatus: ${page.status}\nVersion: ${page.version?.number || 'N/A'}\nCreated: ${page.createdAt || 'N/A'}\n\nContent:\n${body}`,
            },
          ],
        };
      }

      case 'confluence_create_page': {
        const { space_id, title, body, parent_id, status } =
          ConfluenceCreatePageSchema.parse(args);

        const pageData: Record<string, any> = {
          spaceId: space_id,
          title,
          status,
        };

        if (body) {
          pageData.body = {
            representation: 'storage',
            value: body,
          };
        }

        if (parent_id) {
          pageData.parentId = parent_id;
        }

        const response = await confluenceClient.post('/pages', pageData);
        const page = response.data;

        return {
          content: [
            {
              type: 'text',
              text: `Page created!\nID: ${page.id}\nTitle: ${page.title}\nStatus: ${page.status}\nVersion: ${page.version?.number || 1}`,
            },
          ],
        };
      }

      case 'confluence_update_page': {
        const { page_id, title, body, version_number, status } =
          ConfluenceUpdatePageSchema.parse(args);

        const pageData: Record<string, any> = {
          id: page_id,
          title,
          status,
          version: { number: version_number },
        };

        if (body) {
          pageData.body = {
            representation: 'storage',
            value: body,
          };
        }

        const response = await confluenceClient.put(`/pages/${page_id}`, pageData);
        const page = response.data;

        return {
          content: [
            {
              type: 'text',
              text: `Page updated!\nID: ${page.id}\nTitle: ${page.title}\nStatus: ${page.status}\nVersion: ${page.version?.number}`,
            },
          ],
        };
      }

      case 'confluence_list_spaces': {
        const { limit, start, type } = ConfluenceListSpacesSchema.parse(args);
        const params: Record<string, any> = { limit, start };
        if (type) params.type = type;

        const response = await confluenceClient.get('/spaces', { params });
        const spaces = response.data.results || [];

        if (spaces.length === 0) {
          return { content: [{ type: 'text', text: 'No spaces found.' }] };
        }

        const list = spaces
          .map(
            (s: any) =>
              `ID: ${s.id}\nKey: ${s.key}\nName: ${s.name}\nType: ${s.type || 'N/A'}\nStatus: ${s.status || 'N/A'}`,
          )
          .join('\n\n');

        return {
          content: [
            {
              type: 'text',
              text: `Found ${spaces.length} spaces:\n\n${list}`,
            },
          ],
        };
      }

      default:
        return {
          content: [{ type: 'text', text: `Unknown tool: ${name}` }],
        };
    }
  } catch (error: any) {
    const errorMessage =
      error.response?.data?.errorMessages?.[0] ||
      error.response?.data?.message ||
      error.response?.data?.errors?.[0]?.message ||
      error.message;
    return {
      content: [{ type: 'text', text: `Error: ${errorMessage}` }],
    };
  }
}
