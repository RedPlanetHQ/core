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
  milestone: z
    .union([z.string(), z.number()])
    .optional()
    .describe('Milestone number or "*" for any, "none" for no milestone'),
  since: z.string().optional().describe('Filter by issues updated after this date (ISO 8601)'),
  per_page: z.number().optional().default(30).describe('Results per page'),
  page: z.number().optional().default(1).describe('Page number'),
  sort: z
    .enum(['created', 'updated', 'comments'])
    .optional()
    .default('created')
    .describe('Sort field'),
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
  head: z
    .string()
    .optional()
    .describe('Filter by head branch (format: user:ref-name or organization:ref-name)'),
  base: z.string().optional().describe('Filter by base branch'),
  sort: z
    .enum(['created', 'updated', 'popularity', 'long-running'])
    .optional()
    .default('created')
    .describe('Sort field'),
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
  merge_method: z
    .enum(['merge', 'squash', 'rebase'])
    .optional()
    .default('merge')
    .describe('Merge method'),
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
  comments: z
    .array(
      z.object({
        path: z.string().describe('File path'),
        position: z.number().optional().describe('Position in the diff (deprecated, use line)'),
        body: z.string().describe('Comment text'),
        line: z.number().optional().describe('Line number in the file'),
        side: z.enum(['LEFT', 'RIGHT']).optional().default('RIGHT').describe('Side of the diff'),
      }),
    )
    .optional()
    .describe('Line-level comments'),
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
  all: z
    .boolean()
    .optional()
    .default(false)
    .describe('Show all notifications (default: only unread)'),
  participating: z
    .boolean()
    .optional()
    .describe('Show only notifications where user is participating'),
  since: z
    .string()
    .optional()
    .describe('Filter by notifications updated after this date (ISO 8601)'),
  before: z
    .string()
    .optional()
    .describe('Filter by notifications updated before this date (ISO 8601)'),
  per_page: z.number().optional().default(30).describe('Results per page'),
  page: z.number().optional().default(1).describe('Page number'),
});

const MarkNotificationAsReadSchema = z.object({
  thread_id: z.number().describe('Notification thread ID'),
});

const MarkAllNotificationsAsReadSchema = z.object({
  last_read_at: z
    .string()
    .optional()
    .describe('Mark notifications as read up to this time (ISO 8601, defaults to now)'),
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
  sort: z
    .enum([
      'comments',
      'reactions',
      'reactions-+1',
      'reactions--1',
      'reactions-smile',
      'reactions-thinking_face',
      'reactions-heart',
      'reactions-tada',
      'interactions',
      'created',
      'updated',
    ])
    .optional()
    .describe('Sort field'),
  order: z.enum(['asc', 'desc']).optional().default('desc').describe('Sort order'),
  per_page: z.number().optional().default(30).describe('Results per page'),
  page: z.number().optional().default(1).describe('Page number'),
});

const SearchRepositoriesSchema = z.object({
  query: z
    .string()
    .describe(
      'Repository search query. Examples: "machine learning in:name stars:>1000 language:python", "topic:react", "user:facebook". Supports advanced search syntax for precise filtering.',
    ),
  sort: z
    .enum(['stars', 'forks', 'help-wanted-issues', 'updated'])
    .optional()
    .describe('Sort repositories by field, defaults to best match'),
  order: z.enum(['asc', 'desc']).optional().default('desc').describe('Sort order'),
  per_page: z.number().optional().default(30).describe('Results per page (min 1, max 100)'),
  page: z.number().optional().default(1).describe('Page number (min 1)'),
});

// Branch Schemas
const ListBranchesSchema = z.object({
  owner: z.string().describe('Repository owner'),
  repo: z.string().describe('Repository name'),
  protected: z.boolean().optional().describe('Filter by protected branches'),
  per_page: z.number().optional().default(30).describe('Results per page (min 1, max 100)'),
  page: z.number().optional().default(1).describe('Page number (min 1)'),
});

const CreateBranchSchema = z.object({
  owner: z.string().describe('Repository owner'),
  repo: z.string().describe('Repository name'),
  branch: z.string().describe('Name for new branch'),
  from_branch: z.string().optional().describe('Source branch (defaults to repo default)'),
});

// Commit Schemas
const ListCommitsSchema = z.object({
  owner: z.string().describe('Repository owner'),
  repo: z.string().describe('Repository name'),
  sha: z
    .string()
    .optional()
    .describe(
      'Commit SHA, branch or tag name to list commits of. If not provided, uses the default branch of the repository. If a commit SHA is provided, will list commits up to that SHA.',
    ),
  path: z.string().optional().describe('Only commits containing this file path will be returned'),
  author: z.string().optional().describe('Author username or email address to filter commits by'),
  since: z.string().optional().describe('Only commits after this date (ISO 8601)'),
  until: z.string().optional().describe('Only commits before this date (ISO 8601)'),
  per_page: z.number().optional().default(30).describe('Results per page (min 1, max 100)'),
  page: z.number().optional().default(1).describe('Page number (min 1)'),
});

const GetCommitSchema = z.object({
  owner: z.string().describe('Repository owner'),
  repo: z.string().describe('Repository name'),
  sha: z.string().describe('Commit SHA, branch name, or tag name'),
  include_diff: z
    .boolean()
    .optional()
    .default(true)
    .describe('Whether to include file diffs and stats in the response. Default is true.'),
  per_page: z.number().optional().describe('Results per page for pagination (min 1, max 100)'),
  page: z.number().optional().describe('Page number for pagination (min 1)'),
});

// Tag Schemas
const ListTagsSchema = z.object({
  owner: z.string().describe('Repository owner'),
  repo: z.string().describe('Repository name'),
  per_page: z.number().optional().default(30).describe('Results per page (min 1, max 100)'),
  page: z.number().optional().default(1).describe('Page number (min 1)'),
});

const GetTagSchema = z.object({
  owner: z.string().describe('Repository owner'),
  repo: z.string().describe('Repository name'),
  tag: z.string().describe('Tag name'),
});

// Release Schemas
const ListReleasesSchema = z.object({
  owner: z.string().describe('Repository owner'),
  repo: z.string().describe('Repository name'),
  per_page: z.number().optional().default(30).describe('Results per page (min 1, max 100)'),
  page: z.number().optional().default(1).describe('Page number (min 1)'),
});

const GetLatestReleaseSchema = z.object({
  owner: z.string().describe('Repository owner'),
  repo: z.string().describe('Repository name'),
});

const GetReleaseByTagSchema = z.object({
  owner: z.string().describe('Repository owner'),
  repo: z.string().describe('Repository name'),
  tag: z.string().describe("Tag name (e.g., 'v1.0.0')"),
});

// Repository Management Schemas
const CreateRepositorySchema = z.object({
  name: z.string().describe('Repository name'),
  description: z.string().optional().describe('Repository description'),
  private: z.boolean().optional().describe('Whether repo should be private'),
  autoInit: z.boolean().optional().describe('Initialize with README'),
  organization: z
    .string()
    .optional()
    .describe('Organization to create the repository in (omit to create in your personal account)'),
});

const ForkRepositorySchema = z.object({
  owner: z.string().describe('Repository owner'),
  repo: z.string().describe('Repository name'),
  organization: z.string().optional().describe('Organization to fork to'),
});

// Batch File Operations Schema
const PushFilesSchema = z.object({
  owner: z.string().describe('Repository owner'),
  repo: z.string().describe('Repository name'),
  branch: z.string().describe('Branch to push to'),
  message: z.string().describe('Commit message'),
  files: z
    .array(
      z.object({
        path: z.string().describe('File path'),
        content: z.string().describe('File content'),
      }),
    )
    .describe('Array of file objects to push, each object with path (string) and content (string)'),
});

// GitHub Actions/Workflows Schemas
const ListWorkflowsSchema = z.object({
  owner: z.string().describe('Repository owner'),
  repo: z.string().describe('Repository name'),
  per_page: z.number().optional().default(30).describe('Results per page'),
  page: z.number().optional().default(1).describe('Page number'),
});

const ListWorkflowRunsSchema = z.object({
  owner: z.string().describe('Repository owner'),
  repo: z.string().describe('Repository name'),
  workflow_id: z.union([z.string(), z.number()]).optional().describe('Workflow ID or filename (optional, shows all if not provided)'),
  status: z.enum(['completed', 'action_required', 'cancelled', 'failure', 'neutral', 'skipped', 'stale', 'success', 'timed_out', 'in_progress', 'queued', 'requested', 'waiting']).optional().describe('Filter by status'),
  branch: z.string().optional().describe('Filter by branch name'),
  event: z.string().optional().describe('Filter by event (e.g., push, pull_request)'),
  per_page: z.number().optional().default(30).describe('Results per page'),
  page: z.number().optional().default(1).describe('Page number'),
});

const GetWorkflowRunSchema = z.object({
  owner: z.string().describe('Repository owner'),
  repo: z.string().describe('Repository name'),
  run_id: z.number().describe('Workflow run ID'),
});

const RerunWorkflowSchema = z.object({
  owner: z.string().describe('Repository owner'),
  repo: z.string().describe('Repository name'),
  run_id: z.number().describe('Workflow run ID to rerun'),
});

const CancelWorkflowRunSchema = z.object({
  owner: z.string().describe('Repository owner'),
  repo: z.string().describe('Repository name'),
  run_id: z.number().describe('Workflow run ID to cancel'),
});

const TriggerWorkflowSchema = z.object({
  owner: z.string().describe('Repository owner'),
  repo: z.string().describe('Repository name'),
  workflow_id: z.union([z.string(), z.number()]).describe('Workflow ID or filename (e.g., ci.yml)'),
  ref: z.string().describe('Git reference (branch or tag name)'),
  inputs: z.record(z.string()).optional().describe('Input parameters for the workflow'),
});

// Reactions Schemas
const ListIssueReactionsSchema = z.object({
  owner: z.string().describe('Repository owner'),
  repo: z.string().describe('Repository name'),
  issue_number: z.number().describe('Issue number'),
  content: z.enum(['+1', '-1', 'laugh', 'confused', 'heart', 'hooray', 'rocket', 'eyes']).optional().describe('Filter by reaction type'),
  per_page: z.number().optional().default(30).describe('Results per page'),
  page: z.number().optional().default(1).describe('Page number'),
});

const AddIssueReactionSchema = z.object({
  owner: z.string().describe('Repository owner'),
  repo: z.string().describe('Repository name'),
  issue_number: z.number().describe('Issue number'),
  content: z.enum(['+1', '-1', 'laugh', 'confused', 'heart', 'hooray', 'rocket', 'eyes']).describe('Reaction type: +1 (👍), -1 (👎), laugh (😄), confused (😕), heart (❤️), hooray (🎉), rocket (🚀), eyes (👀)'),
});

const AddCommentReactionSchema = z.object({
  owner: z.string().describe('Repository owner'),
  repo: z.string().describe('Repository name'),
  comment_id: z.number().describe('Comment ID'),
  content: z.enum(['+1', '-1', 'laugh', 'confused', 'heart', 'hooray', 'rocket', 'eyes']).describe('Reaction type: +1 (👍), -1 (👎), laugh (😄), confused (😕), heart (❤️), hooray (🎉), rocket (🚀), eyes (👀)'),
});

const DeleteReactionSchema = z.object({
  owner: z.string().describe('Repository owner'),
  repo: z.string().describe('Repository name'),
  reaction_id: z.number().describe('Reaction ID'),
});

// Gists Schemas
const ListGistsSchema = z.object({
  per_page: z.number().optional().default(30).describe('Results per page'),
  page: z.number().optional().default(1).describe('Page number'),
});

const GetGistSchema = z.object({
  gist_id: z.string().describe('Gist ID'),
});

const CreateGistSchema = z.object({
  description: z.string().optional().describe('Gist description'),
  public: z.boolean().optional().default(false).describe('Whether the gist is public'),
  files: z.record(z.object({
    content: z.string().describe('File content'),
  })).describe('Files in the gist. Key is filename, value is object with content.'),
});

const UpdateGistSchema = z.object({
  gist_id: z.string().describe('Gist ID'),
  description: z.string().optional().describe('Updated description'),
  files: z.record(z.union([
    z.object({ content: z.string().describe('New file content') }),
    z.null(),
  ])).optional().describe('Files to update. Key is filename, value is object with content (to update) or null (to delete).'),
});

const DeleteGistSchema = z.object({
  gist_id: z.string().describe('Gist ID to delete'),
});

// ============================================================================
// TOOL EXPORT FUNCTION
// ============================================================================

export async function getTools() {
  const tools = [
    // Repository Tools
    {
      name: 'get_repo',
      description: 'Get details of a specific repository',
      inputSchema: zodToJsonSchema(GetRepoSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'list_repos',
      description: 'List repositories for the authenticated user',
      inputSchema: zodToJsonSchema(ListReposSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },

    // Issue Tools
    {
      name: 'list_issues',
      description: 'List issues in a repository with advanced filtering',
      inputSchema: zodToJsonSchema(ListIssuesSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'get_issue',
      description: 'Get details of a specific issue',
      inputSchema: zodToJsonSchema(GetIssueSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'create_issue',
      description: 'Create a new issue',
      inputSchema: zodToJsonSchema(CreateIssueSchema),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    {
      name: 'update_issue',
      description: 'Update an existing issue',
      inputSchema: zodToJsonSchema(UpdateIssueSchema),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },

    // Issue Comment Tools
    {
      name: 'list_issue_comments',
      description: 'List comments on an issue',
      inputSchema: zodToJsonSchema(ListIssueCommentsSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'create_issue_comment',
      description: 'Create a comment on an issue',
      inputSchema: zodToJsonSchema(CreateIssueCommentSchema),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    {
      name: 'update_issue_comment',
      description: 'Update an existing issue comment',
      inputSchema: zodToJsonSchema(UpdateIssueCommentSchema),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'delete_issue_comment',
      description: 'Delete an issue comment',
      inputSchema: zodToJsonSchema(DeleteIssueCommentSchema),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
    },

    // Pull Request Tools
    {
      name: 'list_pull_requests',
      description: 'List pull requests in a repository',
      inputSchema: zodToJsonSchema(ListPullRequestsSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'get_pull_request',
      description: 'Get details of a specific pull request',
      inputSchema: zodToJsonSchema(GetPullRequestSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'create_pull_request',
      description: 'Create a new pull request',
      inputSchema: zodToJsonSchema(CreatePullRequestSchema),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    {
      name: 'update_pull_request',
      description: 'Update an existing pull request',
      inputSchema: zodToJsonSchema(UpdatePullRequestSchema),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'merge_pull_request',
      description: 'Merge a pull request',
      inputSchema: zodToJsonSchema(MergePullRequestSchema),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
    },

    // Pull Request Review Tools
    {
      name: 'list_pr_reviews',
      description: 'List reviews on a pull request',
      inputSchema: zodToJsonSchema(ListPRReviewsSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'create_pr_review',
      description: 'Create a review on a pull request',
      inputSchema: zodToJsonSchema(CreatePRReviewSchema),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },

    // Pull Request Comment Tools
    {
      name: 'list_pr_comments',
      description: 'List review comments on a pull request',
      inputSchema: zodToJsonSchema(ListPRCommentsSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'create_pr_comment',
      description: 'Create a review comment on a pull request',
      inputSchema: zodToJsonSchema(CreatePRCommentSchema),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },

    // File Operations Tools
    {
      name: 'get_file_content',
      description: 'Get the content of a file from a repository',
      inputSchema: zodToJsonSchema(GetFileContentSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'create_or_update_file',
      description: 'Create or update a file in a repository',
      inputSchema: zodToJsonSchema(CreateOrUpdateFileSchema),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    {
      name: 'delete_file',
      description: 'Delete a file from a repository',
      inputSchema: zodToJsonSchema(DeleteFileSchema),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
    },

    // Project Tools
    {
      name: 'list_projects',
      description: 'List projects for a repository or organization',
      inputSchema: zodToJsonSchema(ListProjectsSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'create_project',
      description: 'Create a new project',
      inputSchema: zodToJsonSchema(CreateProjectSchema),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    {
      name: 'update_project',
      description: 'Update an existing project',
      inputSchema: zodToJsonSchema(UpdateProjectSchema),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'delete_project',
      description: 'Delete a project',
      inputSchema: zodToJsonSchema(DeleteProjectSchema),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
    },

    // Milestone Tools
    {
      name: 'list_milestones',
      description: 'List milestones in a repository',
      inputSchema: zodToJsonSchema(ListMilestonesSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'get_milestone',
      description: 'Get details of a specific milestone',
      inputSchema: zodToJsonSchema(GetMilestoneSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'create_milestone',
      description: 'Create a new milestone',
      inputSchema: zodToJsonSchema(CreateMilestoneSchema),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    {
      name: 'update_milestone',
      description: 'Update an existing milestone',
      inputSchema: zodToJsonSchema(UpdateMilestoneSchema),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'delete_milestone',
      description: 'Delete a milestone',
      inputSchema: zodToJsonSchema(DeleteMilestoneSchema),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
    },

    // Notification Tools
    {
      name: 'list_notifications',
      description: 'List notifications for the authenticated user',
      inputSchema: zodToJsonSchema(ListNotificationsSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'mark_notification_read',
      description: 'Mark a notification as read',
      inputSchema: zodToJsonSchema(MarkNotificationAsReadSchema),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'mark_all_notifications_read',
      description: 'Mark all notifications as read',
      inputSchema: zodToJsonSchema(MarkAllNotificationsAsReadSchema),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },

    // Label Tools
    {
      name: 'list_labels',
      description: 'List labels in a repository',
      inputSchema: zodToJsonSchema(ListLabelsSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'create_label',
      description: 'Create a new label',
      inputSchema: zodToJsonSchema(CreateLabelSchema),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    {
      name: 'update_label',
      description: 'Update an existing label',
      inputSchema: zodToJsonSchema(UpdateLabelSchema),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'delete_label',
      description: 'Delete a label',
      inputSchema: zodToJsonSchema(DeleteLabelSchema),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
    },

    // Search Tools
    {
      name: 'search_code',
      description: 'Search for code across GitHub repositories',
      inputSchema: zodToJsonSchema(SearchCodeSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'search_issues',
      description: 'Search for issues and pull requests',
      inputSchema: zodToJsonSchema(SearchIssuesSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'search_repositories',
      description: 'Search repositories',
      inputSchema: zodToJsonSchema(SearchRepositoriesSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },

    // Branch Tools
    {
      name: 'list_branches',
      description: 'List branches',
      inputSchema: zodToJsonSchema(ListBranchesSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'create_branch',
      description: 'Create branch',
      inputSchema: zodToJsonSchema(CreateBranchSchema),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },

    // Commit Tools
    {
      name: 'list_commits',
      description: 'List commits',
      inputSchema: zodToJsonSchema(ListCommitsSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'get_commit',
      description: 'Get commit details',
      inputSchema: zodToJsonSchema(GetCommitSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },

    // Tag Tools
    {
      name: 'list_tags',
      description: 'List tags',
      inputSchema: zodToJsonSchema(ListTagsSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'get_tag',
      description: 'Get tag details',
      inputSchema: zodToJsonSchema(GetTagSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },

    // Release Tools
    {
      name: 'list_releases',
      description: 'List releases',
      inputSchema: zodToJsonSchema(ListReleasesSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'get_latest_release',
      description: 'Get latest release',
      inputSchema: zodToJsonSchema(GetLatestReleaseSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'get_release_by_tag',
      description: 'Get a release by tag name',
      inputSchema: zodToJsonSchema(GetReleaseByTagSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },

    // Repository Management Tools
    {
      name: 'create_repository',
      description: 'Create repository',
      inputSchema: zodToJsonSchema(CreateRepositorySchema),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    {
      name: 'fork_repository',
      description: 'Fork repository',
      inputSchema: zodToJsonSchema(ForkRepositorySchema),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },

    // Batch File Operations Tool
    {
      name: 'push_files',
      description: 'Push files to repository',
      inputSchema: zodToJsonSchema(PushFilesSchema),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },

    // GitHub Actions/Workflows Tools
    {
      name: 'list_workflows',
      description: 'List repository workflows',
      inputSchema: zodToJsonSchema(ListWorkflowsSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'list_workflow_runs',
      description: 'List workflow runs',
      inputSchema: zodToJsonSchema(ListWorkflowRunsSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'get_workflow_run',
      description: 'Get workflow run details',
      inputSchema: zodToJsonSchema(GetWorkflowRunSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'rerun_workflow',
      description: 'Rerun a workflow',
      inputSchema: zodToJsonSchema(RerunWorkflowSchema),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    {
      name: 'cancel_workflow_run',
      description: 'Cancel a workflow run',
      inputSchema: zodToJsonSchema(CancelWorkflowRunSchema),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    {
      name: 'trigger_workflow',
      description: 'Trigger a workflow dispatch event',
      inputSchema: zodToJsonSchema(TriggerWorkflowSchema),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },

    // Reactions Tools
    {
      name: 'list_issue_reactions',
      description: 'List reactions on an issue',
      inputSchema: zodToJsonSchema(ListIssueReactionsSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'add_issue_reaction',
      description: 'Add reaction to an issue',
      inputSchema: zodToJsonSchema(AddIssueReactionSchema),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    {
      name: 'add_comment_reaction',
      description: 'Add reaction to a comment',
      inputSchema: zodToJsonSchema(AddCommentReactionSchema),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    {
      name: 'delete_reaction',
      description: 'Delete a reaction',
      inputSchema: zodToJsonSchema(DeleteReactionSchema),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
    },

    // Gists Tools
    {
      name: 'list_gists',
      description: 'List your gists',
      inputSchema: zodToJsonSchema(ListGistsSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'get_gist',
      description: 'Get a gist',
      inputSchema: zodToJsonSchema(GetGistSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'create_gist',
      description: 'Create a gist',
      inputSchema: zodToJsonSchema(CreateGistSchema),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    {
      name: 'update_gist',
      description: 'Update a gist',
      inputSchema: zodToJsonSchema(UpdateGistSchema),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'delete_gist',
      description: 'Delete a gist',
      inputSchema: zodToJsonSchema(DeleteGistSchema),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
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
  config: Record<string, string>,
) {
  await initializeGitHubClient(config.access_token);

  try {
    switch (name) {
      // Repository Handlers
      case 'get_repo': {
        const { owner, repo } = GetRepoSchema.parse(args);
        const response = await githubClient.get(`/repos/${owner}/${repo}`);

        const r = response.data;
        const visibility = r.private ? '🔒 Private' : '🌐 Public';
        const license = r.license?.name || 'No license';
        const topics = r.topics?.join(', ') || 'No topics';

        const formatted = `${r.full_name} ${visibility}

Description: ${r.description || 'No description'}
Language: ${r.language || 'Unknown'} | License: ${license}
⭐ ${r.stargazers_count} stars | 🍴 ${r.forks_count} forks | 👀 ${r.watchers_count} watchers
Open issues: ${r.open_issues_count}
Default branch: ${r.default_branch}
Topics: ${topics}

Created: ${r.created_at}
Updated: ${r.updated_at}
Pushed: ${r.pushed_at}

Homepage: ${r.homepage || 'None'}
URL: ${r.html_url}
Clone: ${r.clone_url}`;

        return {
          content: [
            {
              type: 'text',
              text: formatted,
            },
          ],
        };
      }

      case 'list_repos': {
        const { type, sort, direction, per_page, page } = ListReposSchema.parse(args);
        const response = await githubClient.get('/user/repos', {
          params: { type, sort, direction, per_page, page },
        });

        // Format as readable text with essential information
        const formattedRepos = response.data
          .map((repo: any) => {
            const desc = repo.description || 'No description';
            const language = repo.language || 'Unknown';
            const visibility = repo.private ? '🔒 Private' : '🌐 Public';
            return `${repo.full_name} ${visibility}
Description: ${desc}
Language: ${language} | ⭐ ${repo.stargazers_count} | Forks: ${repo.forks_count}
Updated: ${repo.updated_at}
URL: ${repo.html_url}`;
          })
          .join('\n\n');

        return {
          content: [
            {
              type: 'text',
              text: formattedRepos || 'No repositories found',
            },
          ],
        };
      }

      // Issue Handlers
      case 'list_issues': {
        const validated = ListIssuesSchema.parse(args);
        const { owner, repo, ...params } = validated;
        const response = await githubClient.get(`/repos/${owner}/${repo}/issues`, { params });

        // Format as readable text with essential information
        const formattedIssues = response.data
          .map((issue: any) => {
            const labels = issue.labels?.map((l: any) => l.name).join(', ') || 'none';
            const assignees = issue.assignees?.map((a: any) => a.login).join(', ') || 'unassigned';
            return `#${issue.number}: ${issue.title}
State: ${issue.state} | Author: ${issue.user?.login} | Comments: ${issue.comments}
Labels: ${labels}
Assignees: ${assignees}
Created: ${issue.created_at} | Updated: ${issue.updated_at}
URL: ${issue.html_url}`;
          })
          .join('\n\n');

        return {
          content: [
            {
              type: 'text',
              text: formattedIssues || 'No issues found',
            },
          ],
        };
      }

      case 'get_issue': {
        const { owner, repo, issue_number } = GetIssueSchema.parse(args);
        const response = await githubClient.get(`/repos/${owner}/${repo}/issues/${issue_number}`);

        const issue = response.data;
        const labels = issue.labels?.map((l: any) => l.name).join(', ') || 'none';
        const assignees = issue.assignees?.map((a: any) => a.login).join(', ') || 'unassigned';
        const milestone = issue.milestone ? `Milestone: ${issue.milestone.title}` : 'No milestone';

        const formatted = `#${issue.number}: ${issue.title}

State: ${issue.state} | Author: ${issue.user?.login}
Created: ${issue.created_at} | Updated: ${issue.updated_at}
Comments: ${issue.comments} | ${milestone}
Labels: ${labels}
Assignees: ${assignees}

${issue.body || 'No description'}

URL: ${issue.html_url}`;

        return {
          content: [
            {
              type: 'text',
              text: formatted,
            },
          ],
        };
      }

      case 'create_issue': {
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

      case 'update_issue': {
        const { owner, repo, issue_number, ...body } = UpdateIssueSchema.parse(args);
        const response = await githubClient.patch(
          `/repos/${owner}/${repo}/issues/${issue_number}`,
          body,
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
      case 'list_issue_comments': {
        const { owner, repo, issue_number, ...params } = ListIssueCommentsSchema.parse(args);
        const response = await githubClient.get(
          `/repos/${owner}/${repo}/issues/${issue_number}/comments`,
          { params },
        );

        // Format as readable text with essential information
        const formattedComments = response.data
          .map((comment: any) => {
            const bodyPreview = comment.body?.substring(0, 150) || 'No content';
            return `Comment ID: ${comment.id}
Author: ${comment.user?.login} | Created: ${comment.created_at}
${bodyPreview}${comment.body?.length > 150 ? '...' : ''}
URL: ${comment.html_url}`;
          })
          .join('\n\n');

        return {
          content: [
            {
              type: 'text',
              text: formattedComments || 'No comments found',
            },
          ],
        };
      }

      case 'create_issue_comment': {
        const { owner, repo, issue_number, body } = CreateIssueCommentSchema.parse(args);
        const response = await githubClient.post(
          `/repos/${owner}/${repo}/issues/${issue_number}/comments`,
          { body },
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

      case 'update_issue_comment': {
        const { owner, repo, comment_id, body } = UpdateIssueCommentSchema.parse(args);
        const response = await githubClient.patch(
          `/repos/${owner}/${repo}/issues/comments/${comment_id}`,
          { body },
        );
        return {
          content: [
            {
              type: 'text',
              text: `Comment updated successfully\nURL: ${response.data.html_url}`,
            },
          ],
        };
      }

      case 'delete_issue_comment': {
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
      case 'list_pull_requests': {
        const { owner, repo, ...params } = ListPullRequestsSchema.parse(args);
        const response = await githubClient.get(`/repos/${owner}/${repo}/pulls`, { params });

        // Format as readable text with essential information
        const formattedPRs = response.data
          .map((pr: any) => {
            return `#${pr.number}: ${pr.title}
State: ${pr.state} | Author: ${pr.user?.login} | Comments: ${pr.comments}
Branch: ${pr.head?.ref} → ${pr.base?.ref}
Created: ${pr.created_at} | Updated: ${pr.updated_at}
URL: ${pr.html_url}`;
          })
          .join('\n\n');

        return {
          content: [
            {
              type: 'text',
              text: formattedPRs || 'No pull requests found',
            },
          ],
        };
      }

      case 'get_pull_request': {
        const { owner, repo, pull_number } = GetPullRequestSchema.parse(args);
        const response = await githubClient.get(`/repos/${owner}/${repo}/pulls/${pull_number}`);

        const pr = response.data;
        const labels = pr.labels?.map((l: any) => l.name).join(', ') || 'none';
        const reviewers = pr.requested_reviewers?.map((r: any) => r.login).join(', ') || 'none';
        const mergeable = pr.mergeable === null ? 'Unknown' : pr.mergeable ? '✅ Mergeable' : '❌ Conflicts';

        const formatted = `#${pr.number}: ${pr.title}

State: ${pr.state} | ${mergeable} | Author: ${pr.user?.login}
Branch: ${pr.head?.ref} → ${pr.base?.ref}
Created: ${pr.created_at} | Updated: ${pr.updated_at}
Comments: ${pr.comments} | Commits: ${pr.commits} | Changed files: ${pr.changed_files}
Additions: +${pr.additions} | Deletions: -${pr.deletions}
Labels: ${labels}
Reviewers: ${reviewers}

${pr.body || 'No description'}

URL: ${pr.html_url}`;

        return {
          content: [
            {
              type: 'text',
              text: formatted,
            },
          ],
        };
      }

      case 'create_pull_request': {
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

      case 'update_pull_request': {
        const { owner, repo, pull_number, ...body } = UpdatePullRequestSchema.parse(args);
        const response = await githubClient.patch(
          `/repos/${owner}/${repo}/pulls/${pull_number}`,
          body,
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

      case 'merge_pull_request': {
        const { owner, repo, pull_number, ...body } = MergePullRequestSchema.parse(args);
        const response = await githubClient.put(
          `/repos/${owner}/${repo}/pulls/${pull_number}/merge`,
          body,
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
      case 'list_pr_reviews': {
        const { owner, repo, pull_number, ...params } = ListPRReviewsSchema.parse(args);
        const response = await githubClient.get(
          `/repos/${owner}/${repo}/pulls/${pull_number}/reviews`,
          { params },
        );

        // Format as readable text with essential information
        const formattedReviews = response.data
          .map((review: any) => {
            const bodyPreview = review.body?.substring(0, 100) || 'No comment';
            return `Review ID: ${review.id}
Reviewer: ${review.user?.login} | State: ${review.state}
Submitted: ${review.submitted_at}
${bodyPreview}${review.body?.length > 100 ? '...' : ''}
URL: ${review.html_url}`;
          })
          .join('\n\n');

        return {
          content: [
            {
              type: 'text',
              text: formattedReviews || 'No reviews found',
            },
          ],
        };
      }

      case 'create_pr_review': {
        const { owner, repo, pull_number, ...body } = CreatePRReviewSchema.parse(args);
        const response = await githubClient.post(
          `/repos/${owner}/${repo}/pulls/${pull_number}/reviews`,
          body,
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
      case 'list_pr_comments': {
        const { owner, repo, pull_number, ...params } = ListPRCommentsSchema.parse(args);
        const response = await githubClient.get(
          `/repos/${owner}/${repo}/pulls/${pull_number}/comments`,
          { params },
        );

        // Format as readable text with essential information
        const formattedComments = response.data
          .map((comment: any) => {
            const bodyPreview = comment.body?.substring(0, 100) || 'No content';
            const path = comment.path || 'General comment';
            return `Comment ID: ${comment.id}
Author: ${comment.user?.login} | File: ${path}
Created: ${comment.created_at}
${bodyPreview}${comment.body?.length > 100 ? '...' : ''}
URL: ${comment.html_url}`;
          })
          .join('\n\n');

        return {
          content: [
            {
              type: 'text',
              text: formattedComments || 'No comments found',
            },
          ],
        };
      }

      case 'create_pr_comment': {
        const { owner, repo, pull_number, ...body } = CreatePRCommentSchema.parse(args);
        const response = await githubClient.post(
          `/repos/${owner}/${repo}/pulls/${pull_number}/comments`,
          body,
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
      case 'get_file_content': {
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

      case 'create_or_update_file': {
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

      case 'delete_file': {
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
      case 'list_projects': {
        const { owner, repo, ...params } = ListProjectsSchema.parse(args);
        const url = repo ? `/repos/${owner}/${repo}/projects` : `/orgs/${owner}/projects`;
        const response = await githubClient.get(url, {
          params,
          headers: { Accept: 'application/vnd.github+json' },
        });

        // Format as readable text with essential information
        const formattedProjects = response.data
          .map((project: any) => {
            const desc = project.body || 'No description';
            return `${project.name}
State: ${project.state} | Created: ${project.created_at}
Description: ${desc}
URL: ${project.html_url}`;
          })
          .join('\n\n');

        return {
          content: [
            {
              type: 'text',
              text: formattedProjects || 'No projects found',
            },
          ],
        };
      }

      case 'create_project': {
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

      case 'update_project': {
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

      case 'delete_project': {
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
      case 'list_milestones': {
        const { owner, repo, ...params } = ListMilestonesSchema.parse(args);
        const response = await githubClient.get(`/repos/${owner}/${repo}/milestones`, { params });

        // Format as readable text with essential information
        const formattedMilestones = response.data
          .map((milestone: any) => {
            const desc = milestone.description || 'No description';
            const dueDate = milestone.due_on ? `Due: ${milestone.due_on}` : 'No due date';
            return `#${milestone.number}: ${milestone.title}
State: ${milestone.state} | ${dueDate}
Progress: ${milestone.closed_issues}/${milestone.open_issues + milestone.closed_issues} issues closed
Description: ${desc}
URL: ${milestone.html_url}`;
          })
          .join('\n\n');

        return {
          content: [
            {
              type: 'text',
              text: formattedMilestones || 'No milestones found',
            },
          ],
        };
      }

      case 'get_milestone': {
        const { owner, repo, milestone_number } = GetMilestoneSchema.parse(args);
        const response = await githubClient.get(
          `/repos/${owner}/${repo}/milestones/${milestone_number}`,
        );

        const m = response.data;
        const progress = m.closed_issues / (m.open_issues + m.closed_issues) * 100 || 0;
        const dueDate = m.due_on ? `Due: ${m.due_on}` : 'No due date';

        const formatted = `#${m.number}: ${m.title}

State: ${m.state} | ${dueDate}
Progress: ${m.closed_issues}/${m.open_issues + m.closed_issues} issues (${progress.toFixed(0)}%)
Created by: ${m.creator?.login}

${m.description || 'No description'}

URL: ${m.html_url}`;

        return {
          content: [
            {
              type: 'text',
              text: formatted,
            },
          ],
        };
      }

      case 'create_milestone': {
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

      case 'update_milestone': {
        const { owner, repo, milestone_number, ...body } = UpdateMilestoneSchema.parse(args);
        const response = await githubClient.patch(
          `/repos/${owner}/${repo}/milestones/${milestone_number}`,
          body,
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

      case 'delete_milestone': {
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
      case 'list_notifications': {
        const params = ListNotificationsSchema.parse(args);
        const response = await githubClient.get('/notifications', { params });

        // Format as readable text with essential information
        const formattedNotifications = response.data
          .map((notif: any) => {
            const unread = notif.unread ? '🔔 Unread' : '✓ Read';
            return `${unread} | ${notif.subject?.type}: ${notif.subject?.title}
Repository: ${notif.repository?.full_name}
Reason: ${notif.reason} | Updated: ${notif.updated_at}
URL: ${notif.subject?.url}`;
          })
          .join('\n\n');

        return {
          content: [
            {
              type: 'text',
              text: formattedNotifications || 'No notifications found',
            },
          ],
        };
      }

      case 'mark_notification_read': {
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

      case 'mark_all_notifications_read': {
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
      case 'list_labels': {
        const { owner, repo, ...params } = ListLabelsSchema.parse(args);
        const response = await githubClient.get(`/repos/${owner}/${repo}/labels`, { params });

        // Format as readable text with essential information
        const formattedLabels = response.data
          .map((label: any) => {
            const desc = label.description || 'No description';
            return `${label.name} (#${label.color})
Description: ${desc}`;
          })
          .join('\n\n');

        return {
          content: [
            {
              type: 'text',
              text: formattedLabels || 'No labels found',
            },
          ],
        };
      }

      case 'create_label': {
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

      case 'update_label': {
        const { owner, repo, current_name, new_name, color, description } =
          UpdateLabelSchema.parse(args);
        const body: any = {};
        if (new_name) body.new_name = new_name;
        if (color) body.color = color;
        if (description !== undefined) body.description = description;

        const response = await githubClient.patch(
          `/repos/${owner}/${repo}/labels/${current_name}`,
          body,
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

      case 'delete_label': {
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
      case 'search_code': {
        const params = SearchCodeSchema.parse(args);
        const response = await githubClient.get('/search/code', { params });

        // Format as readable text with essential information
        const total = response.data.total_count || 0;
        const formattedResults = response.data.items
          ?.map((item: any) => {
            return `File: ${item.path}
Repository: ${item.repository?.full_name}
URL: ${item.html_url}`;
          })
          .join('\n\n');

        return {
          content: [
            {
              type: 'text',
              text: `Total matches: ${total}\n\n${formattedResults || 'No results found'}`,
            },
          ],
        };
      }

      case 'search_issues': {
        const params = SearchIssuesSchema.parse(args);
        const response = await githubClient.get('/search/issues', { params });

        // Format as readable text with essential information
        const total = response.data.total_count || 0;
        const formattedResults = response.data.items
          ?.map((item: any) => {
            const labels = item.labels?.map((l: any) => l.name).join(', ') || 'none';
            const type = item.pull_request ? 'PR' : 'Issue';
            return `[${type}] ${item.repository_url?.split('/').slice(-2).join('/')}#${item.number}: ${item.title}
State: ${item.state} | Author: ${item.user?.login} | Comments: ${item.comments}
Labels: ${labels}
URL: ${item.html_url}`;
          })
          .join('\n\n');

        return {
          content: [
            {
              type: 'text',
              text: `Total matches: ${total}\n\n${formattedResults || 'No results found'}`,
            },
          ],
        };
      }

      case 'search_repositories': {
        const { query, sort, order, per_page, page } = SearchRepositoriesSchema.parse(args);
        const response = await githubClient.get('/search/repositories', {
          params: { q: query, sort, order, per_page, page },
        });

        // Format as readable text with essential information
        const total = response.data.total_count || 0;
        const formattedRepos = response.data.items
          ?.map((repo: any) => {
            const desc = repo.description || 'No description';
            const language = repo.language || 'Unknown';
            return `${repo.full_name}
Description: ${desc}
Language: ${language} | ⭐ ${repo.stargazers_count} | Forks: ${repo.forks_count}
URL: ${repo.html_url}`;
          })
          .join('\n\n');

        return {
          content: [
            {
              type: 'text',
              text: `Total matches: ${total}\n\n${formattedRepos || 'No repositories found'}`,
            },
          ],
        };
      }

      // Branch Handlers
      case 'list_branches': {
        const {
          owner,
          repo,
          protected: protectedOnly,
          per_page,
          page,
        } = ListBranchesSchema.parse(args);
        const params: any = { per_page, page };
        if (protectedOnly !== undefined) params.protected = protectedOnly;

        const response = await githubClient.get(`/repos/${owner}/${repo}/branches`, { params });

        // Format as readable text with essential information
        const formattedBranches = response.data
          .map((branch: any) => {
            const shortSha = branch.commit?.sha?.substring(0, 7) || 'unknown';
            const protection = branch.protected ? '🔒 Protected' : '';
            return `${branch.name} (${shortSha}) ${protection}`.trim();
          })
          .join('\n');

        return {
          content: [
            {
              type: 'text',
              text: formattedBranches || 'No branches found',
            },
          ],
        };
      }

      case 'create_branch': {
        const { owner, repo, branch, from_branch } = CreateBranchSchema.parse(args);

        // Get the SHA of the source branch (or default branch)
        let sha: string;
        if (from_branch) {
          const refResponse = await githubClient.get(
            `/repos/${owner}/${repo}/git/ref/heads/${from_branch}`,
          );
          sha = refResponse.data.object.sha;
        } else {
          const repoResponse = await githubClient.get(`/repos/${owner}/${repo}`);
          const defaultBranch = repoResponse.data.default_branch;
          const refResponse = await githubClient.get(
            `/repos/${owner}/${repo}/git/ref/heads/${defaultBranch}`,
          );
          sha = refResponse.data.object.sha;
        }

        // Create the new branch
        const response = await githubClient.post(`/repos/${owner}/${repo}/git/refs`, {
          ref: `refs/heads/${branch}`,
          sha: sha,
        });

        return {
          content: [
            {
              type: 'text',
              text: `Branch '${branch}' created successfully\nRef: ${response.data.ref}\nSHA: ${response.data.object.sha}`,
            },
          ],
        };
      }

      // Commit Handlers
      case 'list_commits': {
        const { owner, repo, ...params } = ListCommitsSchema.parse(args);
        const response = await githubClient.get(`/repos/${owner}/${repo}/commits`, { params });

        // Format as readable text with essential information
        const formattedCommits = response.data
          .map((commit: any) => {
            const shortSha = commit.sha.substring(0, 7);
            const message = commit.commit?.message?.split('\n')[0] || 'No message';
            const author = commit.commit?.author?.name || 'Unknown';
            const date = commit.commit?.author?.date || '';
            return `${shortSha}: ${message}
Author: ${author} | Date: ${date}
URL: ${commit.html_url}`;
          })
          .join('\n\n');

        return {
          content: [
            {
              type: 'text',
              text: formattedCommits || 'No commits found',
            },
          ],
        };
      }

      case 'get_commit': {
        const { owner, repo, sha, include_diff, per_page, page } = GetCommitSchema.parse(args);
        const params: any = {};
        if (per_page !== undefined) params.per_page = per_page;
        if (page !== undefined) params.page = page;

        const response = await githubClient.get(`/repos/${owner}/${repo}/commits/${sha}`, {
          params,
        });

        const commit = response.data;
        const shortSha = commit.sha.substring(0, 7);
        const author = commit.commit?.author?.name || 'Unknown';
        const committer = commit.commit?.committer?.name || 'Unknown';
        const verified = commit.commit?.verification?.verified ? '✅ Verified' : '';

        let formatted = `Commit: ${shortSha} ${verified}

Author: ${author} <${commit.commit?.author?.email}>
Date: ${commit.commit?.author?.date}
Committer: ${committer}

${commit.commit?.message || 'No message'}

Stats: ${commit.stats?.additions || 0} additions, ${commit.stats?.deletions || 0} deletions
Files changed: ${commit.files?.length || 0}

URL: ${commit.html_url}`;

        if (include_diff && commit.files?.length > 0) {
          formatted += '\n\nFiles changed:';
          commit.files.forEach((file: any) => {
            formatted += `\n- ${file.filename} (+${file.additions} -${file.deletions}) [${file.status}]`;
          });
        }

        return {
          content: [
            {
              type: 'text',
              text: formatted,
            },
          ],
        };
      }

      // Tag Handlers
      case 'list_tags': {
        const { owner, repo, per_page, page } = ListTagsSchema.parse(args);
        const response = await githubClient.get(`/repos/${owner}/${repo}/tags`, {
          params: { per_page, page },
        });

        // Format as readable text with essential information
        const formattedTags = response.data
          .map((tag: any) => {
            const shortSha = tag.commit?.sha?.substring(0, 7) || 'unknown';
            return `${tag.name} (${shortSha})`;
          })
          .join('\n');

        return {
          content: [
            {
              type: 'text',
              text: formattedTags || 'No tags found',
            },
          ],
        };
      }

      case 'get_tag': {
        const { owner, repo, tag } = GetTagSchema.parse(args);
        const response = await githubClient.get(`/repos/${owner}/${repo}/git/refs/tags/${tag}`);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(response.data, null, 2),
            },
          ],
        };
      }

      // Release Handlers
      case 'list_releases': {
        const { owner, repo, per_page, page } = ListReleasesSchema.parse(args);
        const response = await githubClient.get(`/repos/${owner}/${repo}/releases`, {
          params: { per_page, page },
        });

        // Format as readable text with essential information
        const formattedReleases = response.data
          .map((release: any) => {
            const prerelease = release.prerelease ? '🚧 Pre-release' : '✅ Release';
            const draft = release.draft ? '📝 Draft' : '';
            return `${release.tag_name}: ${release.name || 'Unnamed'} ${prerelease} ${draft}
Author: ${release.author?.login} | Published: ${release.published_at || 'Not published'}
URL: ${release.html_url}`.trim();
          })
          .join('\n\n');

        return {
          content: [
            {
              type: 'text',
              text: formattedReleases || 'No releases found',
            },
          ],
        };
      }

      case 'get_latest_release': {
        const { owner, repo } = GetLatestReleaseSchema.parse(args);
        const response = await githubClient.get(`/repos/${owner}/${repo}/releases/latest`);

        const r = response.data;
        const prerelease = r.prerelease ? '🚧 Pre-release' : '✅ Release';
        const draft = r.draft ? '📝 Draft' : '';
        const assets = r.assets?.length || 0;

        const formatted = `${r.tag_name}: ${r.name || 'Unnamed'} ${prerelease} ${draft}

Author: ${r.author?.login}
Published: ${r.published_at || 'Not published'}
Assets: ${assets}

${r.body || 'No release notes'}

URL: ${r.html_url}`.trim();

        return {
          content: [
            {
              type: 'text',
              text: formatted,
            },
          ],
        };
      }

      case 'get_release_by_tag': {
        const { owner, repo, tag } = GetReleaseByTagSchema.parse(args);
        const response = await githubClient.get(`/repos/${owner}/${repo}/releases/tags/${tag}`);

        const r = response.data;
        const prerelease = r.prerelease ? '🚧 Pre-release' : '✅ Release';
        const draft = r.draft ? '📝 Draft' : '';
        const assets = r.assets?.length || 0;

        const formatted = `${r.tag_name}: ${r.name || 'Unnamed'} ${prerelease} ${draft}

Author: ${r.author?.login}
Published: ${r.published_at || 'Not published'}
Assets: ${assets}

${r.body || 'No release notes'}

URL: ${r.html_url}`.trim();

        return {
          content: [
            {
              type: 'text',
              text: formatted,
            },
          ],
        };
      }

      // Repository Management Handlers
      case 'create_repository': {
        const { organization, ...body } = CreateRepositorySchema.parse(args);

        let response;
        if (organization) {
          // Create in organization
          response = await githubClient.post(`/orgs/${organization}/repos`, body);
        } else {
          // Create in user account
          response = await githubClient.post('/user/repos', body);
        }

        return {
          content: [
            {
              type: 'text',
              text: `Repository created successfully\nName: ${response.data.full_name}\nURL: ${response.data.html_url}`,
            },
          ],
        };
      }

      case 'fork_repository': {
        const { owner, repo, organization } = ForkRepositorySchema.parse(args);
        const body: any = {};
        if (organization) body.organization = organization;

        const response = await githubClient.post(`/repos/${owner}/${repo}/forks`, body);
        return {
          content: [
            {
              type: 'text',
              text: `Repository forked successfully\nForked to: ${response.data.full_name}\nURL: ${response.data.html_url}`,
            },
          ],
        };
      }

      // Batch File Operations Handler
      case 'push_files': {
        const { owner, repo, branch, message, files } = PushFilesSchema.parse(args);

        // Get the current commit SHA of the branch
        const refResponse = await githubClient.get(
          `/repos/${owner}/${repo}/git/ref/heads/${branch}`,
        );
        const latestCommitSha = refResponse.data.object.sha;

        // Get the tree SHA of the latest commit
        const commitResponse = await githubClient.get(
          `/repos/${owner}/${repo}/git/commits/${latestCommitSha}`,
        );
        const baseTreeSha = commitResponse.data.tree.sha;

        // Create blobs for each file
        const treeItems = await Promise.all(
          files.map(async (file) => {
            const blobResponse = await githubClient.post(`/repos/${owner}/${repo}/git/blobs`, {
              content: file.content,
              encoding: 'utf-8',
            });
            return {
              path: file.path,
              mode: '100644',
              type: 'blob',
              sha: blobResponse.data.sha,
            };
          }),
        );

        // Create a new tree
        const treeResponse = await githubClient.post(`/repos/${owner}/${repo}/git/trees`, {
          base_tree: baseTreeSha,
          tree: treeItems,
        });

        // Create a new commit
        const newCommitResponse = await githubClient.post(`/repos/${owner}/${repo}/git/commits`, {
          message: message,
          tree: treeResponse.data.sha,
          parents: [latestCommitSha],
        });

        // Update the branch reference
        await githubClient.patch(`/repos/${owner}/${repo}/git/refs/heads/${branch}`, {
          sha: newCommitResponse.data.sha,
        });

        return {
          content: [
            {
              type: 'text',
              text: `Successfully pushed ${files.length} file(s) to ${branch}\nCommit SHA: ${newCommitResponse.data.sha}\nMessage: ${message}`,
            },
          ],
        };
      }

      // GitHub Actions/Workflows Handlers
      case 'list_workflows': {
        const { owner, repo, per_page, page } = ListWorkflowsSchema.parse(args);
        const response = await githubClient.get(`/repos/${owner}/${repo}/actions/workflows`, {
          params: { per_page, page },
        });

        const formattedWorkflows = response.data.workflows
          ?.map((workflow: any) => {
            const state = workflow.state === 'active' ? '✅ Active' : '⏸️ Disabled';
            return `${workflow.name} ${state}
ID: ${workflow.id} | File: ${workflow.path}
URL: ${workflow.html_url}`;
          })
          .join('\n\n');

        return {
          content: [
            {
              type: 'text',
              text: `Total workflows: ${response.data.total_count}\n\n${formattedWorkflows || 'No workflows found'}`,
            },
          ],
        };
      }

      case 'list_workflow_runs': {
        const { owner, repo, workflow_id, ...params } = ListWorkflowRunsSchema.parse(args);
        const url = workflow_id
          ? `/repos/${owner}/${repo}/actions/workflows/${workflow_id}/runs`
          : `/repos/${owner}/${repo}/actions/runs`;
        const response = await githubClient.get(url, { params });

        const formattedRuns = response.data.workflow_runs
          ?.map((run: any) => {
            const statusIcon = run.conclusion === 'success' ? '✅' : run.conclusion === 'failure' ? '❌' : run.conclusion === 'cancelled' ? '🚫' : '⏳';
            return `${statusIcon} Run #${run.run_number}: ${run.name}
Status: ${run.status} | Conclusion: ${run.conclusion || 'N/A'}
Branch: ${run.head_branch} | Event: ${run.event}
Author: ${run.triggering_actor?.login}
Started: ${run.run_started_at || run.created_at}
URL: ${run.html_url}`;
          })
          .join('\n\n');

        return {
          content: [
            {
              type: 'text',
              text: `Total runs: ${response.data.total_count}\n\n${formattedRuns || 'No workflow runs found'}`,
            },
          ],
        };
      }

      case 'get_workflow_run': {
        const { owner, repo, run_id } = GetWorkflowRunSchema.parse(args);
        const response = await githubClient.get(`/repos/${owner}/${repo}/actions/runs/${run_id}`);

        const run = response.data;
        const statusIcon = run.conclusion === 'success' ? '✅' : run.conclusion === 'failure' ? '❌' : run.conclusion === 'cancelled' ? '🚫' : '⏳';

        const formatted = `${statusIcon} Workflow Run #${run.run_number}: ${run.name}

Status: ${run.status}
Conclusion: ${run.conclusion || 'N/A'}
Branch: ${run.head_branch}
Event: ${run.event}
Triggered by: ${run.triggering_actor?.login}

Started: ${run.run_started_at || run.created_at}
${run.updated_at ? `Updated: ${run.updated_at}` : ''}

URL: ${run.html_url}
Logs: ${run.logs_url}`;

        return {
          content: [
            {
              type: 'text',
              text: formatted,
            },
          ],
        };
      }

      case 'rerun_workflow': {
        const { owner, repo, run_id } = RerunWorkflowSchema.parse(args);
        await githubClient.post(`/repos/${owner}/${repo}/actions/runs/${run_id}/rerun`);
        return {
          content: [
            {
              type: 'text',
              text: `Workflow run #${run_id} has been queued for re-run`,
            },
          ],
        };
      }

      case 'cancel_workflow_run': {
        const { owner, repo, run_id } = CancelWorkflowRunSchema.parse(args);
        await githubClient.post(`/repos/${owner}/${repo}/actions/runs/${run_id}/cancel`);
        return {
          content: [
            {
              type: 'text',
              text: `Workflow run #${run_id} has been cancelled`,
            },
          ],
        };
      }

      case 'trigger_workflow': {
        const { owner, repo, workflow_id, ref, inputs } = TriggerWorkflowSchema.parse(args);
        await githubClient.post(`/repos/${owner}/${repo}/actions/workflows/${workflow_id}/dispatches`, {
          ref,
          inputs: inputs || {},
        });
        return {
          content: [
            {
              type: 'text',
              text: `Workflow '${workflow_id}' triggered on ${ref}`,
            },
          ],
        };
      }

      // Reactions Handlers
      case 'list_issue_reactions': {
        const { owner, repo, issue_number, ...params } = ListIssueReactionsSchema.parse(args);
        const response = await githubClient.get(
          `/repos/${owner}/${repo}/issues/${issue_number}/reactions`,
          { params, headers: { Accept: 'application/vnd.github+json' } },
        );

        const emojiMap: any = {
          '+1': '👍',
          '-1': '👎',
          'laugh': '😄',
          'confused': '😕',
          'heart': '❤️',
          'hooray': '🎉',
          'rocket': '🚀',
          'eyes': '👀',
        };

        const formattedReactions = response.data
          ?.map((reaction: any) => {
            return `${emojiMap[reaction.content]} by ${reaction.user?.login}`;
          })
          .join('\n');

        return {
          content: [
            {
              type: 'text',
              text: formattedReactions || 'No reactions found',
            },
          ],
        };
      }

      case 'add_issue_reaction': {
        const { owner, repo, issue_number, content } = AddIssueReactionSchema.parse(args);
        const response = await githubClient.post(
          `/repos/${owner}/${repo}/issues/${issue_number}/reactions`,
          { content },
          { headers: { Accept: 'application/vnd.github+json' } },
        );

        const emojiMap: any = {
          '+1': '👍',
          '-1': '👎',
          'laugh': '😄',
          'confused': '😕',
          'heart': '❤️',
          'hooray': '🎉',
          'rocket': '🚀',
          'eyes': '👀',
        };

        return {
          content: [
            {
              type: 'text',
              text: `Added reaction ${emojiMap[content]} to issue #${issue_number}`,
            },
          ],
        };
      }

      case 'add_comment_reaction': {
        const { owner, repo, comment_id, content } = AddCommentReactionSchema.parse(args);
        const response = await githubClient.post(
          `/repos/${owner}/${repo}/issues/comments/${comment_id}/reactions`,
          { content },
          { headers: { Accept: 'application/vnd.github+json' } },
        );

        const emojiMap: any = {
          '+1': '👍',
          '-1': '👎',
          'laugh': '😄',
          'confused': '😕',
          'heart': '❤️',
          'hooray': '🎉',
          'rocket': '🚀',
          'eyes': '👀',
        };

        return {
          content: [
            {
              type: 'text',
              text: `Added reaction ${emojiMap[content]} to comment #${comment_id}`,
            },
          ],
        };
      }

      case 'delete_reaction': {
        const { owner, repo, reaction_id } = DeleteReactionSchema.parse(args);
        await githubClient.delete(`/repos/${owner}/${repo}/issues/comments/reactions/${reaction_id}`, {
          headers: { Accept: 'application/vnd.github+json' },
        });
        return {
          content: [
            {
              type: 'text',
              text: `Reaction #${reaction_id} deleted`,
            },
          ],
        };
      }

      // Gists Handlers
      case 'list_gists': {
        const { per_page, page } = ListGistsSchema.parse(args);
        const response = await githubClient.get('/gists', {
          params: { per_page, page },
        });

        const formattedGists = response.data
          ?.map((gist: any) => {
            const visibility = gist.public ? '🌐 Public' : '🔒 Private';
            const description = gist.description || 'No description';
            const fileCount = Object.keys(gist.files || {}).length;
            const fileNames = Object.keys(gist.files || {}).join(', ');
            return `${gist.id} ${visibility}
Description: ${description}
Files (${fileCount}): ${fileNames}
Created: ${gist.created_at}
URL: ${gist.html_url}`;
          })
          .join('\n\n');

        return {
          content: [
            {
              type: 'text',
              text: formattedGists || 'No gists found',
            },
          ],
        };
      }

      case 'get_gist': {
        const { gist_id } = GetGistSchema.parse(args);
        const response = await githubClient.get(`/gists/${gist_id}`);

        const gist = response.data;
        const visibility = gist.public ? '🌐 Public' : '🔒 Private';
        const description = gist.description || 'No description';

        let formatted = `Gist: ${gist.id} ${visibility}

Description: ${description}
Owner: ${gist.owner?.login}
Created: ${gist.created_at}
Updated: ${gist.updated_at}
Comments: ${gist.comments}

Files:`;

        Object.entries(gist.files || {}).forEach(([filename, file]: any) => {
          formatted += `\n\n--- ${filename} (${file.language || 'text'}, ${file.size} bytes) ---\n${file.content}`;
        });

        formatted += `\n\nURL: ${gist.html_url}`;

        return {
          content: [
            {
              type: 'text',
              text: formatted,
            },
          ],
        };
      }

      case 'create_gist': {
        const { description, public: isPublic, files } = CreateGistSchema.parse(args);
        const response = await githubClient.post('/gists', {
          description,
          public: isPublic,
          files,
        });

        return {
          content: [
            {
              type: 'text',
              text: `Gist created successfully\nID: ${response.data.id}\nURL: ${response.data.html_url}`,
            },
          ],
        };
      }

      case 'update_gist': {
        const { gist_id, description, files } = UpdateGistSchema.parse(args);
        const body: any = {};
        if (description !== undefined) body.description = description;
        if (files !== undefined) body.files = files;

        const response = await githubClient.patch(`/gists/${gist_id}`, body);
        return {
          content: [
            {
              type: 'text',
              text: `Gist updated successfully\nID: ${gist_id}\nURL: ${response.data.html_url}`,
            },
          ],
        };
      }

      case 'delete_gist': {
        const { gist_id } = DeleteGistSchema.parse(args);
        await githubClient.delete(`/gists/${gist_id}`);
        return {
          content: [
            {
              type: 'text',
              text: `Gist ${gist_id} deleted successfully`,
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
