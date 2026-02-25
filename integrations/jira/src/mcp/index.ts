/* eslint-disable @typescript-eslint/no-explicit-any */
import axios, { AxiosInstance } from 'axios';
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';

import { getAuthHeaders } from '../utils';

let jiraClient: AxiosInstance;

function initializeClient(config: Record<string, string>) {
  const headers = getAuthHeaders(config.access_token);
  const cloudId = config.cloud_id;

  jiraClient = axios.create({
    baseURL: `https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3`,
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

// ─── Tool Definitions ──────────────────────────────────────────────────────

export async function getTools() {
  return [
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
  initializeClient(config);

  try {
    switch (name) {
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
