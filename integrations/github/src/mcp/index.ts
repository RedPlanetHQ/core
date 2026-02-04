import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import axios, { AxiosInstance } from 'axios';

// GitHub API client
let githubClient: AxiosInstance;

/**
 * Initialize GitHub API client with OAuth token
 */
async function initializeGitHubClient(accessToken: string) {
  githubClient = axios.create({
    baseURL: 'https://api.github.com',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });
}

// ============================================================================
// SCHEMA DEFINITIONS
// ============================================================================

// Repository Schemas
const GetRepoSchema = z.object({
  owner: z.string().describe('Repository owner (username or organization)'),
  repo: z.string().describe('Repository name'),
});

const ListReposSchema = z.object({
  type: z
    .enum(['all', 'owner', 'public', 'private', 'member'])
    .optional()
    .default('all')
    .describe('Type of repositories to list'),
  sort: z
    .enum(['created', 'updated', 'pushed', 'full_name'])
    .optional()
    .default('updated')
    .describe('Property to sort repositories by'),
  direction: z.enum(['asc', 'desc']).optional().default('desc').describe('Sort direction'),
  per_page: z.number().optional().default(30).describe('Results per page (max 100)'),
  page: z.number().optional().default(1).describe('Page number'),
});

// Issue Schemas
const ListIssuesSchema = z.object({
  owner: z.string().describe('Repository owner'),
  repo: z.string().describe('Repository name'),
  state: z.enum(['open', 'closed', 'all']).optional().default('open').describe('Issue state'),
  labels: z.array(z.string()).optional().describe('Filter by label names'),
  assignee: z.string().optional().describe('Filter by assignee username'),
  creator: z.string().optional().describe('Filter by creator username'),
  mentioned: z.string().optional().describe('Filter by mentioned username'),
  milestone: z.union([z.string(), z.number()]).optional().describe('Milestone number or "*" for any, "none" for no milestone'),
  since: z.string().optional().describe('Filter by issues updated after this date (ISO 8601)'),
  per_page: z.number().optional().default(30).describe('Results per page'),
  page: z.number().optional().default(1).describe('Page number'),
  sort: z.enum(['created', 'updated', 'comments']).optional().default('created').describe('Sort field'),
  direction: z.enum(['asc', 'desc']).optional().default('desc').describe('Sort direction'),
});

const GetIssueSchema = z.object({
  owner: z.string().describe('Repository owner'),
  repo: z.string().describe('Repository name'),
  issue_number: z.number().describe('Issue number'),
});

const CreateIssueSchema = z.object({
  owner: z.string().describe('Repository owner'),
  repo: z.string().describe('Repository name'),
  title: z.string().describe('Issue title'),
  body: z.string().optional().describe('Issue body/description'),
  assignees: z.array(z.string()).optional().describe('Usernames to assign to the issue'),
  milestone: z.number().optional().describe('Milestone number to associate'),
  labels: z.array(z.string()).optional().describe('Labels to associate with the issue'),
});

const UpdateIssueSchema = z.object({
  owner: z.string().describe('Repository owner'),
  repo: z.string().describe('Repository name'),
  issue_number: z.number().describe('Issue number'),
  title: z.string().optional().describe('New issue title'),
  body: z.string().optional().describe('New issue body'),
  state: z.enum(['open', 'closed']).optional().describe('Issue state'),
  assignees: z.array(z.string()).optional().describe('Usernames to assign'),
  milestone: z.number().nullable().optional().describe('Milestone number (null to remove)'),
  labels: z.array(z.string()).optional().describe('Labels to set'),
});

// Issue Comment Schemas
const ListIssueCommentsSchema = z.object({
  owner: z.string().describe('Repository owner'),
  repo: z.string().describe('Repository name'),
  issue_number: z.number().describe('Issue number'),
  since: z.string().optional().describe('Filter by comments created after this date (ISO 8601)'),
  per_page: z.number().optional().default(30).describe('Results per page'),
  page: z.number().optional().default(1).describe('Page number'),
});

const CreateIssueCommentSchema = z.object({
  owner: z.string().describe('Repository owner'),
  repo: z.string().describe('Repository name'),
  issue_number: z.number().describe('Issue number'),
  body: z.string().describe('Comment body'),
});

const UpdateIssueCommentSchema = z.object({
  owner: z.string().describe('Repository owner'),
  repo: z.string().describe('Repository name'),
  comment_id: z.number().describe('Comment ID'),
  body: z.string().describe('New comment body'),
});

const DeleteIssueCommentSchema = z.object({
  owner: z.string().describe('Repository owner'),
  repo: z.string().describe('Repository name'),
  comment_id: z.number().describe('Comment ID'),
});

// Pull Request Schemas
const ListPullRequestsSchema = z.object({
  owner: z.string().describe('Repository owner'),
  repo: z.string().describe('Repository name'),
  state: z.enum(['open', 'closed', 'all']).optional().default('open').describe('PR state'),
  head: z.string().optional().describe('Filter by head branch (format: user:ref-name or organization:ref-name)'),
  base: z.string().optional().describe('Filter by base branch'),
  sort: z.enum(['created', 'updated', 'popularity', 'long-running']).optional().default('created').describe('Sort field'),
  direction: z.enum(['asc', 'desc']).optional().default('desc').describe('Sort direction'),
  per_page: z.number().optional().default(30).describe('Results per page'),
  page: z.number().optional().default(1).describe('Page number'),
});

const GetPullRequestSchema = z.object({
  owner: z.string().describe('Repository owner'),
  repo: z.string().describe('Repository name'),
  pull_number: z.number().describe('Pull request number'),
});

const CreatePullRequestSchema = z.object({
  owner: z.string().describe('Repository owner'),
  repo: z.string().describe('Repository name'),
  title: z.string().describe('Pull request title'),
  head: z.string().describe('The name of the branch where your changes are implemented'),
  base: z.string().describe('The name of the branch you want the changes pulled into'),
  body: z.string().optional().describe('Pull request description'),
  draft: z.boolean().optional().describe('Whether to create as a draft PR'),
  maintainer_can_modify: z.boolean().optional().describe('Whether maintainers can modify the PR'),
});

const UpdatePullRequestSchema = z.object({
  owner: z.string().describe('Repository owner'),
  repo: z.string().describe('Repository name'),
  pull_number: z.number().describe('Pull request number'),
  title: z.string().optional().describe('New PR title'),
  body: z.string().optional().describe('New PR body'),
  state: z.enum(['open', 'closed']).optional().describe('PR state'),
  base: z.string().optional().describe('New base branch'),
  maintainer_can_modify: z.boolean().optional().describe('Whether maintainers can modify'),
});

const MergePullRequestSchema = z.object({
  owner: z.string().describe('Repository owner'),
  repo: z.string().describe('Repository name'),
  pull_number: z.number().describe('Pull request number'),
  commit_title: z.string().optional().describe('Title for the automatic commit message'),
  commit_message: z.string().optional().describe('Extra detail for the automatic commit message'),
  merge_method: z.enum(['merge', 'squash', 'rebase']).optional().default('merge').describe('Merge method'),
});

// Pull Request Review Schemas
const ListPRReviewsSchema = z.object({
  owner: z.string().describe('Repository owner'),
  repo: z.string().describe('Repository name'),
  pull_number: z.number().describe('Pull request number'),
  per_page: z.number().optional().default(30).describe('Results per page'),
  page: z.number().optional().default(1).describe('Page number'),
});

const CreatePRReviewSchema = z.object({
  owner: z.string().describe('Repository owner'),
  repo: z.string().describe('Repository name'),
  pull_number: z.number().describe('Pull request number'),
  body: z.string().optional().describe('Review body'),
  event: z.enum(['APPROVE', 'REQUEST_CHANGES', 'COMMENT']).describe('Review action'),
  comments: z.array(z.object({
    path: z.string().describe('File path'),
    position: z.number().optional().describe('Position in the diff (deprecated, use line)'),
    body: z.string().describe('Comment text'),
    line: z.number().optional().describe('Line number in the file'),
    side: z.enum(['LEFT', 'RIGHT']).optional().default('RIGHT').describe('Side of the diff'),
  })).optional().describe('Line-level comments'),
});

// Pull Request Comment Schemas
const ListPRCommentsSchema = z.object({
  owner: z.string().describe('Repository owner'),
  repo: z.string().describe('Repository name'),
  pull_number: z.number().describe('Pull request number'),
  since: z.string().optional().describe('Filter by comments created after this date (ISO 8601)'),
  per_page: z.number().optional().default(30).describe('Results per page'),
  page: z.number().optional().default(1).describe('Page number'),
});

const CreatePRCommentSchema = z.object({
  owner: z.string().describe('Repository owner'),
  repo: z.string().describe('Repository name'),
  pull_number: z.number().describe('Pull request number'),
  body: z.string().describe('Comment body'),
  commit_id: z.string().optional().describe('SHA of the commit to comment on'),
  path: z.string().optional().describe('Relative path of the file to comment on'),
  line: z.number().optional().describe('Line number in the file to comment on'),
  side: z.enum(['LEFT', 'RIGHT']).optional().default('RIGHT').describe('Side of the diff'),
});

// File Operations Schemas
const GetFileContentSchema = z.object({
  owner: z.string().describe('Repository owner'),
  repo: z.string().describe('Repository name'),
  path: z.string().describe('Path to the file'),
  ref: z.string().optional().describe('Branch, tag, or commit SHA (defaults to default branch)'),
});

const CreateOrUpdateFileSchema = z.object({
  owner: z.string().describe('Repository owner'),
  repo: z.string().describe('Repository name'),
  path: z.string().describe('Path where to create/update the file'),
  message: z.string().describe('Commit message'),
  content: z.string().describe('File content (will be base64 encoded)'),
  branch: z.string().optional().describe('Branch to create/update file in'),
  sha: z.string().optional().describe('SHA of the file being replaced (required for updates)'),
});

const DeleteFileSchema = z.object({
  owner: z.string().describe('Repository owner'),
  repo: z.string().describe('Repository name'),
  path: z.string().describe('Path to the file'),
  message: z.string().describe('Commit message'),
  sha: z.string().describe('SHA of the file to delete'),
  branch: z.string().optional().describe('Branch to delete file from'),
});

// Project Schemas (Projects V2 - GraphQL-based)
const ListProjectsSchema = z.object({
  owner: z.string().describe('Repository owner or organization'),
  repo: z.string().optional().describe('Repository name (omit for organization projects)'),
  per_page: z.number().optional().default(30).describe('Results per page'),
  page: z.number().optional().default(1).describe('Page number'),
});

const CreateProjectSchema = z.object({
  owner: z.string().describe('Repository owner or organization'),
  name: z.string().describe('Project name'),
  body: z.string().optional().describe('Project description'),
});

const UpdateProjectSchema = z.object({
  project_id: z.number().describe('Project ID'),
  name: z.string().optional().describe('New project name'),
  body: z.string().optional().describe('New project description'),
  state: z.enum(['open', 'closed']).optional().describe('Project state'),
});

const DeleteProjectSchema = z.object({
  project_id: z.number().describe('Project ID'),
});

// Milestone Schemas
const ListMilestonesSchema = z.object({
  owner: z.string().describe('Repository owner'),
  repo: z.string().describe('Repository name'),
  state: z.enum(['open', 'closed', 'all']).optional().default('open').describe('Milestone state'),
  sort: z.enum(['due_on', 'completeness']).optional().default('due_on').describe('Sort field'),
  direction: z.enum(['asc', 'desc']).optional().default('asc').describe('Sort direction'),
  per_page: z.number().optional().default(30).describe('Results per page'),
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
  due_on: z.string().optional().describe('Due date (ISO 8601 format: YYYY-MM-DDTHH:MM:SSZ)'),
});

const UpdateMilestoneSchema = z.object({
  owner: z.string().describe('Repository owner'),
  repo: z.string().describe('Repository name'),
  milestone_number: z.number().describe('Milestone number'),
  title: z.string().optional().describe('New milestone title'),
  state: z.enum(['open', 'closed']).optional().describe('Milestone state'),
  description: z.string().optional().describe('New milestone description'),
  due_on: z.string().optional().describe('New due date (ISO 8601 format)'),
});

const DeleteMilestoneSchema = z.object({
  owner: z.string().describe('Repository owner'),
  repo: z.string().describe('Repository name'),
  milestone_number: z.number().describe('Milestone number'),
});

// Notification Schemas
const ListNotificationsSchema = z.object({
  all: z.boolean().optional().default(false).describe('Show all notifications (default: only unread)'),
  participating: z.boolean().optional().describe('Show only notifications where user is participating'),
  since: z.string().optional().describe('Filter by notifications updated after this date (ISO 8601)'),
  before: z.string().optional().describe('Filter by notifications updated before this date (ISO 8601)'),
  per_page: z.number().optional().default(30).describe('Results per page'),
  page: z.number().optional().default(1).describe('Page number'),
});

const MarkNotificationAsReadSchema = z.object({
  thread_id: z.number().describe('Notification thread ID'),
});

const MarkAllNotificationsAsReadSchema = z.object({
  last_read_at: z.string().optional().describe('Mark notifications as read up to this time (ISO 8601, defaults to now)'),
});

// Label Schemas
const ListLabelsSchema = z.object({
  owner: z.string().describe('Repository owner'),
  repo: z.string().describe('Repository name'),
  per_page: z.number().optional().default(30).describe('Results per page'),
  page: z.number().optional().default(1).describe('Page number'),
});

const CreateLabelSchema = z.object({
  owner: z.string().describe('Repository owner'),
  repo: z.string().describe('Repository name'),
  name: z.string().describe('Label name'),
  color: z.string().describe('Label color (hex code without leading #)'),
  description: z.string().optional().describe('Label description'),
});

const UpdateLabelSchema = z.object({
  owner: z.string().describe('Repository owner'),
  repo: z.string().describe('Repository name'),
  current_name: z.string().describe('Current label name'),
  new_name: z.string().optional().describe('New label name'),
  color: z.string().optional().describe('New label color (hex code without leading #)'),
  description: z.string().optional().describe('New label description'),
});

const DeleteLabelSchema = z.object({
  owner: z.string().describe('Repository owner'),
  repo: z.string().describe('Repository name'),
  name: z.string().describe('Label name'),
});

// Search Schema
const SearchCodeSchema = z.object({
  q: z.string().describe('Search query'),
  sort: z.enum(['indexed']).optional().describe('Sort field'),
  order: z.enum(['asc', 'desc']).optional().default('desc').describe('Sort order'),
  per_page: z.number().optional().default(30).describe('Results per page'),
  page: z.number().optional().default(1).describe('Page number'),
});

const SearchIssuesSchema = z.object({
  q: z.string().describe('Search query'),
  sort: z.enum(['comments', 'reactions', 'reactions-+1', 'reactions--1', 'reactions-smile', 'reactions-thinking_face', 'reactions-heart', 'reactions-tada', 'interactions', 'created', 'updated']).optional().describe('Sort field'),
  order: z.enum(['asc', 'desc']).optional().default('desc').describe('Sort order'),
  per_page: z.number().optional().default(30).describe('Results per page'),
  page: z.number().optional().default(1).describe('Page number'),
});

// ============================================================================
// TOOL EXPORT FUNCTION
// ============================================================================

export async function getTools() {
  const tools = [
    // Repository Tools
    {
      name: 'github_get_repo',
      description: 'Get details of a specific repository',
      inputSchema: zodToJsonSchema(GetRepoSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'github_list_repos',
      description: 'List repositories for the authenticated user',
      inputSchema: zodToJsonSchema(ListReposSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },

    // Issue Tools
    {
      name: 'github_list_issues',
      description: 'List issues in a repository with advanced filtering',
      inputSchema: zodToJsonSchema(ListIssuesSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'github_get_issue',
      description: 'Get details of a specific issue',
      inputSchema: zodToJsonSchema(GetIssueSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'github_create_issue',
      description: 'Create a new issue',
      inputSchema: zodToJsonSchema(CreateIssueSchema),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    {
      name: 'github_update_issue',
      description: 'Update an existing issue',
      inputSchema: zodToJsonSchema(UpdateIssueSchema),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },

    // Issue Comment Tools
    {
      name: 'github_list_issue_comments',
      description: 'List comments on an issue',
      inputSchema: zodToJsonSchema(ListIssueCommentsSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'github_create_issue_comment',
      description: 'Create a comment on an issue',
      inputSchema: zodToJsonSchema(CreateIssueCommentSchema),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    {
      name: 'github_update_issue_comment',
      description: 'Update an existing issue comment',
      inputSchema: zodToJsonSchema(UpdateIssueCommentSchema),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'github_delete_issue_comment',
      description: 'Delete an issue comment',
      inputSchema: zodToJsonSchema(DeleteIssueCommentSchema),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
    },

    // Pull Request Tools
    {
      name: 'github_list_pull_requests',
      description: 'List pull requests in a repository',
      inputSchema: zodToJsonSchema(ListPullRequestsSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'github_get_pull_request',
      description: 'Get details of a specific pull request',
      inputSchema: zodToJsonSchema(GetPullRequestSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'github_create_pull_request',
      description: 'Create a new pull request',
      inputSchema: zodToJsonSchema(CreatePullRequestSchema),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    {
      name: 'github_update_pull_request',
      description: 'Update an existing pull request',
      inputSchema: zodToJsonSchema(UpdatePullRequestSchema),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'github_merge_pull_request',
      description: 'Merge a pull request',
      inputSchema: zodToJsonSchema(MergePullRequestSchema),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
    },

    // Pull Request Review Tools
    {
      name: 'github_list_pr_reviews',
      description: 'List reviews on a pull request',
      inputSchema: zodToJsonSchema(ListPRReviewsSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'github_create_pr_review',
      description: 'Create a review on a pull request',
      inputSchema: zodToJsonSchema(CreatePRReviewSchema),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },

    // Pull Request Comment Tools
    {
      name: 'github_list_pr_comments',
      description: 'List review comments on a pull request',
      inputSchema: zodToJsonSchema(ListPRCommentsSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'github_create_pr_comment',
      description: 'Create a review comment on a pull request',
      inputSchema: zodToJsonSchema(CreatePRCommentSchema),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },

    // File Operations Tools
    {
      name: 'github_get_file_content',
      description: 'Get the content of a file from a repository',
      inputSchema: zodToJsonSchema(GetFileContentSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'github_create_or_update_file',
      description: 'Create or update a file in a repository',
      inputSchema: zodToJsonSchema(CreateOrUpdateFileSchema),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    {
      name: 'github_delete_file',
      description: 'Delete a file from a repository',
      inputSchema: zodToJsonSchema(DeleteFileSchema),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
    },

    // Project Tools
    {
      name: 'github_list_projects',
      description: 'List projects for a repository or organization',
      inputSchema: zodToJsonSchema(ListProjectsSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'github_create_project',
      description: 'Create a new project',
      inputSchema: zodToJsonSchema(CreateProjectSchema),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    {
      name: 'github_update_project',
      description: 'Update an existing project',
      inputSchema: zodToJsonSchema(UpdateProjectSchema),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'github_delete_project',
      description: 'Delete a project',
      inputSchema: zodToJsonSchema(DeleteProjectSchema),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
    },

    // Milestone Tools
    {
      name: 'github_list_milestones',
      description: 'List milestones in a repository',
      inputSchema: zodToJsonSchema(ListMilestonesSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'github_get_milestone',
      description: 'Get details of a specific milestone',
      inputSchema: zodToJsonSchema(GetMilestoneSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'github_create_milestone',
      description: 'Create a new milestone',
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
      description: 'Delete a milestone',
      inputSchema: zodToJsonSchema(DeleteMilestoneSchema),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
    },

    // Notification Tools
    {
      name: 'github_list_notifications',
      description: 'List notifications for the authenticated user',
      inputSchema: zodToJsonSchema(ListNotificationsSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'github_mark_notification_read',
      description: 'Mark a notification as read',
      inputSchema: zodToJsonSchema(MarkNotificationAsReadSchema),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'github_mark_all_notifications_read',
      description: 'Mark all notifications as read',
      inputSchema: zodToJsonSchema(MarkAllNotificationsAsReadSchema),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },

    // Label Tools
    {
      name: 'github_list_labels',
      description: 'List labels in a repository',
      inputSchema: zodToJsonSchema(ListLabelsSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'github_create_label',
      description: 'Create a new label',
      inputSchema: zodToJsonSchema(CreateLabelSchema),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    {
      name: 'github_update_label',
      description: 'Update an existing label',
      inputSchema: zodToJsonSchema(UpdateLabelSchema),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'github_delete_label',
      description: 'Delete a label',
      inputSchema: zodToJsonSchema(DeleteLabelSchema),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
    },

    // Search Tools
    {
      name: 'github_search_code',
      description: 'Search for code across GitHub repositories',
      inputSchema: zodToJsonSchema(SearchCodeSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'github_search_issues',
      description: 'Search for issues and pull requests',
      inputSchema: zodToJsonSchema(SearchIssuesSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
  ];

  return tools;
}

// ============================================================================
// TOOL CALL HANDLERS
// ============================================================================

export async function callTool(
  name: string,
  args: Record<string, any>,
  config: Record<string, string>
) {
  await initializeGitHubClient(config.access_token);

  try {
    switch (name) {
      // Repository Handlers
      case 'github_get_repo': {
        const { owner, repo } = GetRepoSchema.parse(args);
        const response = await githubClient.get(`/repos/${owner}/${repo}`);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(response.data, null, 2),
            },
          ],
        };
      }

      case 'github_list_repos': {
        const { type, sort, direction, per_page, page } = ListReposSchema.parse(args);
        const response = await githubClient.get('/user/repos', {
          params: { type, sort, direction, per_page, page },
        });
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(response.data, null, 2),
            },
          ],
        };
      }

      // Issue Handlers
      case 'github_list_issues': {
        const validated = ListIssuesSchema.parse(args);
        const { owner, repo, ...params } = validated;
        const response = await githubClient.get(`/repos/${owner}/${repo}/issues`, { params });
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(response.data, null, 2),
            },
          ],
        };
      }

      case 'github_get_issue': {
        const { owner, repo, issue_number } = GetIssueSchema.parse(args);
        const response = await githubClient.get(`/repos/${owner}/${repo}/issues/${issue_number}`);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(response.data, null, 2),
            },
          ],
        };
      }

      case 'github_create_issue': {
        const { owner, repo, ...body } = CreateIssueSchema.parse(args);
        const response = await githubClient.post(`/repos/${owner}/${repo}/issues`, body);
        return {
          content: [
            {
              type: 'text',
              text: `Issue created successfully: #${response.data.number}\nURL: ${response.data.html_url}`,
            },
          ],
        };
      }

      case 'github_update_issue': {
        const { owner, repo, issue_number, ...body } = UpdateIssueSchema.parse(args);
        const response = await githubClient.patch(
          `/repos/${owner}/${repo}/issues/${issue_number}`,
          body
        );
        return {
          content: [
            {
              type: 'text',
              text: `Issue #${issue_number} updated successfully\nURL: ${response.data.html_url}`,
            },
          ],
        };
      }

      // Issue Comment Handlers
      case 'github_list_issue_comments': {
        const { owner, repo, issue_number, ...params } = ListIssueCommentsSchema.parse(args);
        const response = await githubClient.get(
          `/repos/${owner}/${repo}/issues/${issue_number}/comments`,
          { params }
        );
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(response.data, null, 2),
            },
          ],
        };
      }

      case 'github_create_issue_comment': {
        const { owner, repo, issue_number, body } = CreateIssueCommentSchema.parse(args);
        const response = await githubClient.post(
          `/repos/${owner}/${repo}/issues/${issue_number}/comments`,
          { body }
        );
        return {
          content: [
            {
              type: 'text',
              text: `Comment created successfully\nComment ID: ${response.data.id}\nURL: ${response.data.html_url}`,
            },
          ],
        };
      }

      case 'github_update_issue_comment': {
        const { owner, repo, comment_id, body } = UpdateIssueCommentSchema.parse(args);
        const response = await githubClient.patch(`/repos/${owner}/${repo}/issues/comments/${comment_id}`, { body });
        return {
          content: [
            {
              type: 'text',
              text: `Comment updated successfully\nURL: ${response.data.html_url}`,
            },
          ],
        };
      }

      case 'github_delete_issue_comment': {
        const { owner, repo, comment_id } = DeleteIssueCommentSchema.parse(args);
        await githubClient.delete(`/repos/${owner}/${repo}/issues/comments/${comment_id}`);
        return {
          content: [
            {
              type: 'text',
              text: `Comment ${comment_id} deleted successfully`,
            },
          ],
        };
      }

      // Pull Request Handlers
      case 'github_list_pull_requests': {
        const { owner, repo, ...params } = ListPullRequestsSchema.parse(args);
        const response = await githubClient.get(`/repos/${owner}/${repo}/pulls`, { params });
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(response.data, null, 2),
            },
          ],
        };
      }

      case 'github_get_pull_request': {
        const { owner, repo, pull_number } = GetPullRequestSchema.parse(args);
        const response = await githubClient.get(`/repos/${owner}/${repo}/pulls/${pull_number}`);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(response.data, null, 2),
            },
          ],
        };
      }

      case 'github_create_pull_request': {
        const { owner, repo, ...body } = CreatePullRequestSchema.parse(args);
        const response = await githubClient.post(`/repos/${owner}/${repo}/pulls`, body);
        return {
          content: [
            {
              type: 'text',
              text: `Pull request created successfully: #${response.data.number}\nURL: ${response.data.html_url}`,
            },
          ],
        };
      }

      case 'github_update_pull_request': {
        const { owner, repo, pull_number, ...body } = UpdatePullRequestSchema.parse(args);
        const response = await githubClient.patch(
          `/repos/${owner}/${repo}/pulls/${pull_number}`,
          body
        );
        return {
          content: [
            {
              type: 'text',
              text: `Pull request #${pull_number} updated successfully\nURL: ${response.data.html_url}`,
            },
          ],
        };
      }

      case 'github_merge_pull_request': {
        const { owner, repo, pull_number, ...body } = MergePullRequestSchema.parse(args);
        const response = await githubClient.put(
          `/repos/${owner}/${repo}/pulls/${pull_number}/merge`,
          body
        );
        return {
          content: [
            {
              type: 'text',
              text: `Pull request #${pull_number} merged successfully\nSHA: ${response.data.sha}`,
            },
          ],
        };
      }

      // Pull Request Review Handlers
      case 'github_list_pr_reviews': {
        const { owner, repo, pull_number, ...params } = ListPRReviewsSchema.parse(args);
        const response = await githubClient.get(
          `/repos/${owner}/${repo}/pulls/${pull_number}/reviews`,
          { params }
        );
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(response.data, null, 2),
            },
          ],
        };
      }

      case 'github_create_pr_review': {
        const { owner, repo, pull_number, ...body } = CreatePRReviewSchema.parse(args);
        const response = await githubClient.post(
          `/repos/${owner}/${repo}/pulls/${pull_number}/reviews`,
          body
        );
        return {
          content: [
            {
              type: 'text',
              text: `Review created successfully\nReview ID: ${response.data.id}\nURL: ${response.data.html_url}`,
            },
          ],
        };
      }

      // Pull Request Comment Handlers
      case 'github_list_pr_comments': {
        const { owner, repo, pull_number, ...params } = ListPRCommentsSchema.parse(args);
        const response = await githubClient.get(
          `/repos/${owner}/${repo}/pulls/${pull_number}/comments`,
          { params }
        );
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(response.data, null, 2),
            },
          ],
        };
      }

      case 'github_create_pr_comment': {
        const { owner, repo, pull_number, ...body } = CreatePRCommentSchema.parse(args);
        const response = await githubClient.post(
          `/repos/${owner}/${repo}/pulls/${pull_number}/comments`,
          body
        );
        return {
          content: [
            {
              type: 'text',
              text: `Comment created successfully\nComment ID: ${response.data.id}\nURL: ${response.data.html_url}`,
            },
          ],
        };
      }

      // File Operations Handlers
      case 'github_get_file_content': {
        const { owner, repo, path, ref } = GetFileContentSchema.parse(args);
        const response = await githubClient.get(`/repos/${owner}/${repo}/contents/${path}`, {
          params: { ref },
        });
        const content = Buffer.from(response.data.content, 'base64').toString('utf-8');
        return {
          content: [
            {
              type: 'text',
              text: `File: ${path}\nSHA: ${response.data.sha}\nSize: ${response.data.size} bytes\n\n${content}`,
            },
          ],
        };
      }

      case 'github_create_or_update_file': {
        const { owner, repo, path, message, content, branch, sha } =
          CreateOrUpdateFileSchema.parse(args);
        const encodedContent = Buffer.from(content).toString('base64');
        const body: any = { message, content: encodedContent };
        if (branch) body.branch = branch;
        if (sha) body.sha = sha;

        const response = await githubClient.put(`/repos/${owner}/${repo}/contents/${path}`, body);
        return {
          content: [
            {
              type: 'text',
              text: `File ${sha ? 'updated' : 'created'} successfully\nPath: ${path}\nCommit SHA: ${response.data.commit.sha}`,
            },
          ],
        };
      }

      case 'github_delete_file': {
        const { owner, repo, path, message, sha, branch } = DeleteFileSchema.parse(args);
        const body: any = { message, sha };
        if (branch) body.branch = branch;

        const response = await githubClient.delete(`/repos/${owner}/${repo}/contents/${path}`, {
          data: body,
        });
        return {
          content: [
            {
              type: 'text',
              text: `File deleted successfully\nPath: ${path}\nCommit SHA: ${response.data.commit.sha}`,
            },
          ],
        };
      }

      // Project Handlers
      case 'github_list_projects': {
        const { owner, repo, ...params } = ListProjectsSchema.parse(args);
        const url = repo ? `/repos/${owner}/${repo}/projects` : `/orgs/${owner}/projects`;
        const response = await githubClient.get(url, {
          params,
          headers: { Accept: 'application/vnd.github+json' },
        });
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(response.data, null, 2),
            },
          ],
        };
      }

      case 'github_create_project': {
        const { owner, ...body } = CreateProjectSchema.parse(args);
        const response = await githubClient.post(`/orgs/${owner}/projects`, body, {
          headers: { Accept: 'application/vnd.github+json' },
        });
        return {
          content: [
            {
              type: 'text',
              text: `Project created successfully\nProject ID: ${response.data.id}\nURL: ${response.data.html_url}`,
            },
          ],
        };
      }

      case 'github_update_project': {
        const { project_id, ...body } = UpdateProjectSchema.parse(args);
        const response = await githubClient.patch(`/projects/${project_id}`, body, {
          headers: { Accept: 'application/vnd.github+json' },
        });
        return {
          content: [
            {
              type: 'text',
              text: `Project updated successfully\nProject ID: ${project_id}`,
            },
          ],
        };
      }

      case 'github_delete_project': {
        const { project_id } = DeleteProjectSchema.parse(args);
        await githubClient.delete(`/projects/${project_id}`, {
          headers: { Accept: 'application/vnd.github+json' },
        });
        return {
          content: [
            {
              type: 'text',
              text: `Project ${project_id} deleted successfully`,
            },
          ],
        };
      }

      // Milestone Handlers
      case 'github_list_milestones': {
        const { owner, repo, ...params } = ListMilestonesSchema.parse(args);
        const response = await githubClient.get(`/repos/${owner}/${repo}/milestones`, { params });
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(response.data, null, 2),
            },
          ],
        };
      }

      case 'github_get_milestone': {
        const { owner, repo, milestone_number } = GetMilestoneSchema.parse(args);
        const response = await githubClient.get(
          `/repos/${owner}/${repo}/milestones/${milestone_number}`
        );
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(response.data, null, 2),
            },
          ],
        };
      }

      case 'github_create_milestone': {
        const { owner, repo, ...body } = CreateMilestoneSchema.parse(args);
        const response = await githubClient.post(`/repos/${owner}/${repo}/milestones`, body);
        return {
          content: [
            {
              type: 'text',
              text: `Milestone created successfully\nMilestone #${response.data.number}\nURL: ${response.data.html_url}`,
            },
          ],
        };
      }

      case 'github_update_milestone': {
        const { owner, repo, milestone_number, ...body } = UpdateMilestoneSchema.parse(args);
        const response = await githubClient.patch(
          `/repos/${owner}/${repo}/milestones/${milestone_number}`,
          body
        );
        return {
          content: [
            {
              type: 'text',
              text: `Milestone #${milestone_number} updated successfully\nURL: ${response.data.html_url}`,
            },
          ],
        };
      }

      case 'github_delete_milestone': {
        const { owner, repo, milestone_number } = DeleteMilestoneSchema.parse(args);
        await githubClient.delete(`/repos/${owner}/${repo}/milestones/${milestone_number}`);
        return {
          content: [
            {
              type: 'text',
              text: `Milestone #${milestone_number} deleted successfully`,
            },
          ],
        };
      }

      // Notification Handlers
      case 'github_list_notifications': {
        const params = ListNotificationsSchema.parse(args);
        const response = await githubClient.get('/notifications', { params });
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(response.data, null, 2),
            },
          ],
        };
      }

      case 'github_mark_notification_read': {
        const { thread_id } = MarkNotificationAsReadSchema.parse(args);
        await githubClient.patch(`/notifications/threads/${thread_id}`);
        return {
          content: [
            {
              type: 'text',
              text: `Notification ${thread_id} marked as read`,
            },
          ],
        };
      }

      case 'github_mark_all_notifications_read': {
        const body = MarkAllNotificationsAsReadSchema.parse(args);
        await githubClient.put('/notifications', body);
        return {
          content: [
            {
              type: 'text',
              text: 'All notifications marked as read',
            },
          ],
        };
      }

      // Label Handlers
      case 'github_list_labels': {
        const { owner, repo, ...params } = ListLabelsSchema.parse(args);
        const response = await githubClient.get(`/repos/${owner}/${repo}/labels`, { params });
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(response.data, null, 2),
            },
          ],
        };
      }

      case 'github_create_label': {
        const { owner, repo, ...body } = CreateLabelSchema.parse(args);
        const response = await githubClient.post(`/repos/${owner}/${repo}/labels`, body);
        return {
          content: [
            {
              type: 'text',
              text: `Label created successfully\nName: ${response.data.name}\nColor: #${response.data.color}`,
            },
          ],
        };
      }

      case 'github_update_label': {
        const { owner, repo, current_name, new_name, color, description } =
          UpdateLabelSchema.parse(args);
        const body: any = {};
        if (new_name) body.new_name = new_name;
        if (color) body.color = color;
        if (description !== undefined) body.description = description;

        const response = await githubClient.patch(
          `/repos/${owner}/${repo}/labels/${current_name}`,
          body
        );
        return {
          content: [
            {
              type: 'text',
              text: `Label updated successfully\nName: ${response.data.name}`,
            },
          ],
        };
      }

      case 'github_delete_label': {
        const { owner, repo, name } = DeleteLabelSchema.parse(args);
        await githubClient.delete(`/repos/${owner}/${repo}/labels/${name}`);
        return {
          content: [
            {
              type: 'text',
              text: `Label '${name}' deleted successfully`,
            },
          ],
        };
      }

      // Search Handlers
      case 'github_search_code': {
        const params = SearchCodeSchema.parse(args);
        const response = await githubClient.get('/search/code', { params });
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(response.data, null, 2),
            },
          ],
        };
      }

      case 'github_search_issues': {
        const params = SearchIssuesSchema.parse(args);
        const response = await githubClient.get('/search/issues', { params });
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(response.data, null, 2),
            },
          ],
        };
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error: any) {
    const errorMessage = error.response?.data?.message || error.message;
    return {
      content: [
        {
          type: 'text',
          text: `Error: ${errorMessage}`,
        },
      ],
    };
  }
}
