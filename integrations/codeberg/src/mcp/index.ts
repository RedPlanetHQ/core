import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import axios, { AxiosInstance } from "axios";

// Codeberg API client
let codebergClient: AxiosInstance;

/**
 * Initialize Codeberg API client with OAuth token
 */
async function initializeCodebergClient(accessToken: string) {
  codebergClient = axios.create({
    baseURL: "https://codeberg.org/api/v1",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
    },
  });
}

// ============================================================================
// SCHEMA DEFINITIONS
// ============================================================================

// Repository Schemas
const GetRepoSchema = z.object({
  owner: z.string().describe("Repository owner (username or organization)"),
  repo: z.string().describe("Repository name"),
});

const ListReposSchema = z.object({
  limit: z.number().optional().default(30).describe("Results per page"),
  page: z.number().optional().default(1).describe("Page number"),
});

// Issue Schemas
const ListIssuesSchema = z.object({
  owner: z.string().describe("Repository owner"),
  repo: z.string().describe("Repository name"),
  state: z.enum(["open", "closed", "all"]).optional().default("open").describe("Issue state"),
  page: z.number().optional().default(1).describe("Page number"),
  limit: z.number().optional().default(30).describe("Results per page"),
});

const GetIssueSchema = z.object({
  owner: z.string().describe("Repository owner"),
  repo: z.string().describe("Repository name"),
  issue_number: z.number().describe("Issue number"),
});

const CreateIssueSchema = z.object({
  owner: z.string().describe("Repository owner"),
  repo: z.string().describe("Repository name"),
  title: z.string().describe("Issue title"),
  body: z.string().optional().describe("Issue body/description"),
  assignees: z.array(z.string()).optional().describe("Usernames to assign to the issue"),
  milestone: z.number().optional().describe("Milestone number to associate"),
  labels: z
    .array(z.union([z.number(), z.string()]))
    .optional()
    .describe("Label IDs or names to associate with the issue"),
});

const UpdateIssueSchema = z.object({
  owner: z.string().describe("Repository owner"),
  repo: z.string().describe("Repository name"),
  issue_number: z.number().describe("Issue number"),
  title: z.string().optional().describe("New issue title"),
  body: z.string().optional().describe("New issue body"),
  state: z.enum(["open", "closed"]).optional().describe("Issue state"),
  assignees: z.array(z.string()).optional().describe("Usernames to assign"),
  milestone: z.number().nullable().optional().describe("Milestone number (null to remove)"),
  labels: z
    .array(z.union([z.number(), z.string()]))
    .optional()
    .describe("Label IDs or names to replace existing labels"),
});

const SearchIssuesSchema = z.object({
  owner: z.string().describe("Repository owner"),
  repo: z.string().describe("Repository name"),
  q: z.string().describe("Search query"),
  state: z.enum(["open", "closed", "all"]).optional().default("all").describe("Issue state"),
  labels: z.array(z.string()).optional().describe("Filter by labels"),
  page: z.number().optional().default(1).describe("Page number"),
  limit: z.number().optional().default(30).describe("Results per page"),
});

// Label Schemas
const ListLabelsSchema = z.object({
  owner: z.string().describe("Repository owner"),
  repo: z.string().describe("Repository name"),
  limit: z.number().optional().default(100).describe("Results per page"),
  page: z.number().optional().default(1).describe("Page number"),
});

const CreateLabelSchema = z.object({
  owner: z.string().describe("Repository owner"),
  repo: z.string().describe("Repository name"),
  name: z.string().describe("Label name"),
  color: z.string().describe("Label color (e.g., #ff0000)"),
  description: z.string().optional().describe("Label description"),
});

const UpdateLabelSchema = z.object({
  owner: z.string().describe("Repository owner"),
  repo: z.string().describe("Repository name"),
  label_id: z.number().describe("Label ID to update"),
  name: z.string().optional().describe("New label name"),
  color: z.string().optional().describe("New label color"),
  description: z.string().optional().describe("New label description"),
});

const DeleteLabelSchema = z.object({
  owner: z.string().describe("Repository owner"),
  repo: z.string().describe("Repository name"),
  label_id: z.number().describe("Label ID to delete"),
});

// Comment Schemas
const ListIssueCommentsSchema = z.object({
  owner: z.string().describe("Repository owner"),
  repo: z.string().describe("Repository name"),
  issue_number: z.number().describe("Issue number"),
});

const CreateIssueCommentSchema = z.object({
  owner: z.string().describe("Repository owner"),
  repo: z.string().describe("Repository name"),
  issue_number: z.number().describe("Issue number"),
  body: z.string().describe("Comment body"),
});

// Helper function to resolve label names to IDs
async function resolveLabelIds(
  owner: string,
  repo: string,
  labels: (string | number)[]
): Promise<number[]> {
  const ids: number[] = [];
  const namesToResolve: string[] = [];

  for (const label of labels) {
    if (typeof label === "number") {
      ids.push(label);
    } else {
      namesToResolve.push(label);
    }
  }

  if (namesToResolve.length > 0) {
    const response = await codebergClient.get(
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/labels?limit=1000`
    );
    const allLabels = response.data;

    for (const name of namesToResolve) {
      const found = allLabels.find((l: any) => l.name === name);
      if (found) {
        ids.push(found.id);
      } else {
        throw new Error(`Label not found: ${name}`);
      }
    }
  }
  return ids;
}

// Pull Request Schemas
const ListPullRequestsSchema = z.object({
  owner: z.string().describe("Repository owner"),
  repo: z.string().describe("Repository name"),
  state: z.enum(["open", "closed", "all"]).optional().default("open").describe("PR state"),
  page: z.number().optional().default(1).describe("Page number"),
  limit: z.number().optional().default(30).describe("Results per page"),
});

const GetPullRequestSchema = z.object({
  owner: z.string().describe("Repository owner"),
  repo: z.string().describe("Repository name"),
  pull_number: z.number().describe("Pull request number"),
});

const CreatePullRequestSchema = z.object({
  owner: z.string().describe("Repository owner"),
  repo: z.string().describe("Repository name"),
  title: z.string().describe("Pull request title"),
  head: z.string().describe("The name of the branch where your changes are implemented"),
  base: z.string().describe("The name of the branch you want the changes pulled into"),
  body: z.string().optional().describe("Pull request description"),
});

const UpdatePullRequestSchema = z.object({
  owner: z.string().describe("Repository owner"),
  repo: z.string().describe("Repository name"),
  pull_number: z.number().describe("Pull request number"),
  title: z.string().optional().describe("New PR title"),
  body: z.string().optional().describe("New PR body"),
  state: z.enum(["open", "closed"]).optional().describe("New state"),
  base: z.string().optional().describe("New base branch"),
});

const MergePullRequestSchema = z.object({
  owner: z.string().describe("Repository owner"),
  repo: z.string().describe("Repository name"),
  pull_number: z.number().describe("Pull request number"),
  Do: z
    .enum(["merge", "rebase", "rebase-merge", "squash"])
    .optional()
    .default("merge")
    .describe("Merge style"),
  MergeTitleField: z.string().optional().describe("Title for the merge commit"),
  MergeMessageField: z.string().optional().describe("Message for the merge commit"),
});

// Content Schemas
const GetFileContentsSchema = z.object({
  owner: z.string().describe("Repository owner"),
  repo: z.string().describe("Repository name"),
  path: z.string().describe("File path"),
  ref: z
    .string()
    .optional()
    .describe("The name of the commit/branch/tag. Default the repository’s default branch"),
});

const CreateOrUpdateFileSchema = z.object({
  owner: z.string().describe("Repository owner"),
  repo: z.string().describe("Repository name"),
  path: z.string().describe("File path"),
  content: z.string().describe("File content (base64 encoded or plain text)"),
  message: z.string().optional().describe("Commit message"),
  branch: z.string().optional().describe("Branch name. Default the repository’s default branch"),
  sha: z
    .string()
    .optional()
    .describe("The blob SHA of the file being replaced (required for updates)"),
});

const DeleteFileSchema = z.object({
  owner: z.string().describe("Repository owner"),
  repo: z.string().describe("Repository name"),
  path: z.string().describe("File path"),
  message: z.string().optional().describe("Commit message"),
  branch: z.string().optional().describe("Branch name"),
  sha: z.string().describe("The blob SHA of the file being deleted"),
});

// Search Schema
const SearchRepositoriesSchema = z.object({
  q: z.string().describe("Keyword to search"),
  limit: z.number().optional().default(30).describe("Results per page"),
  page: z.number().optional().default(1).describe("Page number"),
});

// Empty Schema for get_me
const EmptySchema = z.object({});

// ============================================================================
// HELPERS
// ============================================================================

async function resolveLabelIds(
  owner: string,
  repo: string,
  labels: (string | number)[]
): Promise<number[]> {
  const ids: number[] = [];
  const namesToResolve: string[] = [];

  for (const label of labels) {
    if (typeof label === "number") {
      ids.push(label);
    } else {
      namesToResolve.push(label);
    }
  }

  if (namesToResolve.length > 0) {
    const response = await codebergClient.get(
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/labels?limit=1000`
    );
    const allLabels = response.data;

    for (const name of namesToResolve) {
      const found = allLabels.find((l: any) => l.name === name);
      if (found) {
        ids.push(found.id);
      } else {
        throw new Error(`Label not found: ${name}`);
      }
    }
  }
  return ids;
}

// ============================================================================
// TOOL EXPORT FUNCTION
// ============================================================================

export async function getTools() {
  const tools = [
    // Identity Tool
    {
      name: "get_me",
      description: "Get information about the currently authenticated user",
      inputSchema: zodToJsonSchema(EmptySchema),
    },

    // Repository Tools
    {
      name: "get_repo",
      description: "Get details of a specific repository",
      inputSchema: zodToJsonSchema(GetRepoSchema),
    },
    {
      name: "list_repos",
      description: "List repositories for the authenticated user",
      inputSchema: zodToJsonSchema(ListReposSchema),
    },
    {
      name: "search_repositories",
      description: "Search for repositories",
      inputSchema: zodToJsonSchema(SearchRepositoriesSchema),
    },

    // Issue Tools
    {
      name: "list_issues",
      description: "List issues in a repository",
      inputSchema: zodToJsonSchema(ListIssuesSchema),
    },
    {
      name: "get_issue",
      description: "Get details of a specific issue",
      inputSchema: zodToJsonSchema(GetIssueSchema),
    },
    {
      name: "create_issue",
      description: "Create a new issue",
      inputSchema: zodToJsonSchema(CreateIssueSchema),
    },
    {
      name: "update_issue",
      description: "Update an existing issue",
      inputSchema: zodToJsonSchema(UpdateIssueSchema),
    },
    {
      name: "search_issues",
      description: "Search for issues in a repository",
      inputSchema: zodToJsonSchema(SearchIssuesSchema),
    },

    // Label Tools
    {
      name: "list_labels",
      description: "List labels in a repository",
      inputSchema: zodToJsonSchema(ListLabelsSchema),
    },
    {
      name: "create_label",
      description: "Create a new label",
      inputSchema: zodToJsonSchema(CreateLabelSchema),
    },
    {
      name: "update_label",
      description: "Update an existing label",
      inputSchema: zodToJsonSchema(UpdateLabelSchema),
    },
    {
      name: "delete_label",
      description: "Delete a label",
      inputSchema: zodToJsonSchema(DeleteLabelSchema),
    },

    // Label Tools
    {
      name: "list_labels",
      description: "List labels in a repository",
      inputSchema: zodToJsonSchema(ListLabelsSchema),
    },
    {
      name: "create_label",
      description: "Create a new label",
      inputSchema: zodToJsonSchema(CreateLabelSchema),
    },

    // Comment Tools
    {
      name: "list_issue_comments",
      description: "List comments on an issue",
      inputSchema: zodToJsonSchema(ListIssueCommentsSchema),
    },
    {
      name: "create_issue_comment",
      description: "Create a comment on an issue",
      inputSchema: zodToJsonSchema(CreateIssueCommentSchema),
    },

    // Pull Request Tools
    {
      name: "list_pull_requests",
      description: "List pull requests in a repository",
      inputSchema: zodToJsonSchema(ListPullRequestsSchema),
    },
    {
      name: "get_pull_request",
      description: "Get details of a specific pull request",
      inputSchema: zodToJsonSchema(GetPullRequestSchema),
    },
    {
      name: "create_pull_request",
      description: "Create a new pull request",
      inputSchema: zodToJsonSchema(CreatePullRequestSchema),
    },
    {
      name: "update_pull_request",
      description: "Update an existing pull request",
      inputSchema: zodToJsonSchema(UpdatePullRequestSchema),
    },
    {
      name: "merge_pull_request",
      description: "Merge a pull request",
      inputSchema: zodToJsonSchema(MergePullRequestSchema),
    },

    // Content Tools
    {
      name: "get_file_contents",
      description: "Get the contents of a file in a repository",
      inputSchema: zodToJsonSchema(GetFileContentsSchema),
    },
    {
      name: "create_or_update_file",
      description: "Create or update a file in a repository",
      inputSchema: zodToJsonSchema(CreateOrUpdateFileSchema),
    },
    {
      name: "delete_file",
      description: "Delete a file in a repository",
      inputSchema: zodToJsonSchema(DeleteFileSchema),
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
  await initializeCodebergClient(config.access_token);

  try {
    switch (name) {
      // Identity Handler
      case "get_me": {
        const response = await codebergClient.get("/user");
        const u = response.data;
        return {
          content: [
            {
              type: "text",
              text: `Username: ${u.login}\nFull Name: ${u.full_name}\nEmail: ${u.email}\nID: ${u.id}\nURL: ${u.html_url}`,
            },
          ],
        };
      }

      // Repository Handlers
      case "get_repo": {
        const { owner, repo } = GetRepoSchema.parse(args);
        const response = await codebergClient.get(
          `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`
        );

        const r = response.data;
        const visibility = r.private ? "🔒 Private" : "🌐 Public";

        const formatted = `${r.full_name} ${visibility}

Description: ${r.description || "No description"}
⭐ ${r.stars_count} stars | 🍴 ${r.forks_count} forks | 👀 ${r.watchers_count} watchers
Open issues: ${r.open_issues_count}
Default branch: ${r.default_branch}

Created: ${r.created_at}
Updated: ${r.updated_at}

HTML URL: ${r.html_url}
Clone URL: ${r.clone_url}`;

        return {
          content: [
            {
              type: "text",
              text: formatted,
            },
          ],
        };
      }

      case "list_repos": {
        const { limit, page } = ListReposSchema.parse(args);
        const response = await codebergClient.get("/user/repos", {
          params: { limit, page },
        });

        // Format as readable text with essential information
        const formattedRepos = response.data
          .map((repo: any) => {
            const desc = repo.description || "No description";
            const visibility = repo.private ? "🔒 Private" : "🌐 Public";
            return `${repo.full_name} ${visibility}
Description: ${desc}
⭐ ${repo.stars_count} | Forks: ${repo.forks_count}
URL: ${repo.html_url}`;
          })
          .join("\n\n");

        return {
          content: [
            {
              type: "text",
              text: formattedRepos || "No repositories found",
            },
          ],
        };
      }

      // Issue Handlers
      case "list_issues": {
        const validated = ListIssuesSchema.parse(args);
        const { owner, repo, ...params } = validated;
        const response = await codebergClient.get(
          `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues`,
          { params }
        );

        // Format as readable text with essential information
        const formattedIssues = response.data
          .map((issue: any) => {
            const labels = issue.labels?.map((l: any) => l.name).join(", ") || "none";
            const assignees = issue.assignees?.map((a: any) => a.login).join(", ") || "unassigned";
            return `#${issue.number}: ${issue.title}
State: ${issue.state} | Author: ${issue.user?.login} | Comments: ${issue.comments}
Labels: ${labels}
Assignees: ${assignees}
Created: ${issue.created_at} | Updated: ${issue.updated_at}
URL: ${issue.html_url}`;
          })
          .join("\n\n");

        return {
          content: [
            {
              type: "text",
              text: formattedIssues || "No issues found",
            },
          ],
        };
      }

      case "create_issue": {
        const { owner, repo, labels, ...body } = CreateIssueSchema.parse(args);

        let labelIds: number[] | undefined;
        if (labels && labels.length > 0) {
          labelIds = await resolveLabelIds(owner, repo, labels);
        }

        const response = await codebergClient.post(
          `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues`,
          {
            ...body,
            labels: labelIds,
          }
        );
        return {
          content: [
            {
              type: "text",
              text: `Issue created successfully: #${response.data.number}\nURL: ${response.data.html_url}`,
            },
          ],
        };
      }

      case "get_issue": {
        const { owner, repo, issue_number } = GetIssueSchema.parse(args);
        const response = await codebergClient.get(
          `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues/${issue_number}`
        );

        const issue = response.data;
        const labels = issue.labels?.map((l: any) => l.name).join(", ") || "none";
        const assignees = issue.assignees?.map((a: any) => a.login).join(", ") || "unassigned";

        const formatted = `#${issue.number}: ${issue.title}

State: ${issue.state} | Author: ${issue.user?.login}
Created: ${issue.created_at} | Updated: ${issue.updated_at}
Comments: ${issue.comments}
Labels: ${labels}
Assignees: ${assignees}

${issue.body || "No description"}

URL: ${issue.html_url}`;

        return {
          content: [
            {
              type: "text",
              text: formatted,
            },
          ],
        };
      }

      case "update_issue": {
        const { owner, repo, issue_number, labels, ...body } = UpdateIssueSchema.parse(args);

        let labelIds: number[] | undefined;
        if (labels && labels.length > 0) {
          labelIds = await resolveLabelIds(owner, repo, labels);
        }

        const response = await codebergClient.patch(
          `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues/${issue_number}`,
          {
            ...body,
            labels: labelIds,
          }
        );
        return {
          content: [
            {
              type: "text",
              text: `Issue #${issue_number} updated successfully\nURL: ${response.data.html_url}`,
            },
          ],
        };
      }

      case "search_issues": {
        const { owner, repo, ...params } = SearchIssuesSchema.parse(args);
        const response = await codebergClient.get(
          `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues`,
          { params }
        );

        const formattedIssues = response.data
          .map((issue: any) => {
            const labels = issue.labels?.map((l: any) => l.name).join(", ") || "none";
            return `#${issue.number}: ${issue.title}\nState: ${issue.state} | Labels: ${labels}`;
          })
          .join("\n\n");

        return {
          content: [
            {
              type: "text",
              text: formattedIssues || "No issues matching query found",
            },
          ],
        };
      }

      // Label Handlers
      case "list_labels": {
        const { owner, repo, limit, page } = ListLabelsSchema.parse(args);
        const response = await codebergClient.get(
          `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/labels`,
          { params: { limit, page } }
        );

        const formattedLabels = response.data
          .map((label: any) => {
            return `ID: ${label.id} | Name: ${label.name} | Color: #${label.color}\nDescription: ${label.description || "None"}`;
          })
          .join("\n\n");

        return {
          content: [
            {
              type: "text",
              text: formattedLabels || "No labels found",
            },
          ],
        };
      }

      case "create_label": {
        const { owner, repo, ...body } = CreateLabelSchema.parse(args);
        const response = await codebergClient.post(
          `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/labels`,
          body
        );
        return {
          content: [
            {
              type: "text",
              text: `Label created successfully: ${response.data.name} (ID: ${response.data.id})\nColor: #${response.data.color}`,
            },
          ],
        };
      }

      case "update_label": {
        const { owner, repo, label_id, ...body } = UpdateLabelSchema.parse(args);
        const response = await codebergClient.patch(
          `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/labels/${label_id}`,
          body
        );
        return {
          content: [
            {
              type: "text",
              text: `Label ID ${label_id} updated successfully.`,
            },
          ],
        };
      }

      case "delete_label": {
        const { owner, repo, label_id } = DeleteLabelSchema.parse(args);
        await codebergClient.delete(
          `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/labels/${label_id}`
        );
        return {
          content: [
            {
              type: "text",
              text: `Label ID ${label_id} deleted successfully.`,
            },
          ],
        };
      }

      // Comment Handlers
      case "list_issue_comments": {
        const { owner, repo, issue_number } = ListIssueCommentsSchema.parse(args);
        const response = await codebergClient.get(
          `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues/${issue_number}/comments`
        );

        const formattedComments = response.data
          .map((comment: any) => {
            const bodyPreview = comment.body?.substring(0, 150) || "No content";
            return `ID: ${comment.id} | Author: ${comment.user?.login} | Created: ${comment.created_at}
${bodyPreview}${comment.body?.length > 150 ? "..." : ""}
URL: ${comment.html_url}`;
          })
          .join("\n\n");

        return {
          content: [
            {
              type: "text",
              text: formattedComments || "No comments found",
            },
          ],
        };
      }

      case "create_issue_comment": {
        const { owner, repo, issue_number, body } = CreateIssueCommentSchema.parse(args);
        const response = await codebergClient.post(
          `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues/${issue_number}/comments`,
          { body }
        );
        return {
          content: [
            {
              type: "text",
              text: `Comment created successfully\nURL: ${response.data.html_url}`,
            },
          ],
        };
      }

      // Pull Request Handlers
      case "list_pull_requests": {
        const { owner, repo, ...params } = ListPullRequestsSchema.parse(args);
        const response = await codebergClient.get(
          `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls`,
          { params }
        );

        const formattedPRs = response.data
          .map((pr: any) => {
            return `#${pr.number}: ${pr.title}
State: ${pr.state} | Author: ${pr.user?.login}
Branch: ${pr.head?.ref} → ${pr.base?.ref}
URL: ${pr.html_url}`;
          })
          .join("\n\n");

        return {
          content: [
            {
              type: "text",
              text: formattedPRs || "No pull requests found",
            },
          ],
        };
      }

      case "get_pull_request": {
        const { owner, repo, pull_number } = GetPullRequestSchema.parse(args);
        const response = await codebergClient.get(
          `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls/${pull_number}`
        );

        const pr = response.data;
        const mergeable = pr.mergeable ? "✅ Mergeable" : "❌ Conflicts";

        const formatted = `#${pr.number}: ${pr.title}

State: ${pr.state} | ${mergeable} | Author: ${pr.user?.login}
Branch: ${pr.head?.ref} → ${pr.base?.ref}
Created: ${pr.created_at} | Updated: ${pr.updated_at}

${pr.body || "No description"}

URL: ${pr.html_url}`;

        return {
          content: [
            {
              type: "text",
              text: formatted,
            },
          ],
        };
      }

      case "create_pull_request": {
        const { owner, repo, ...body } = CreatePullRequestSchema.parse(args);
        const response = await codebergClient.post(
          `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls`,
          body
        );
        return {
          content: [
            {
              type: "text",
              text: `Pull request created successfully: #${response.data.number}\nURL: ${response.data.html_url}`,
            },
          ],
        };
      }

      case "update_pull_request": {
        const { owner, repo, pull_number, ...body } = UpdatePullRequestSchema.parse(args);
        const response = await codebergClient.patch(
          `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls/${pull_number}`,
          body
        );
        return {
          content: [
            {
              type: "text",
              text: `Pull request #${pull_number} updated successfully\nURL: ${response.data.html_url}`,
            },
          ],
        };
      }

      case "merge_pull_request": {
        const { owner, repo, pull_number, ...body } = MergePullRequestSchema.parse(args);
        await codebergClient.post(
          `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls/${pull_number}/merge`,
          body
        );
        return {
          content: [
            {
              type: "text",
              text: `Pull request #${pull_number} merged successfully.`,
            },
          ],
        };
      }

      // Content Handlers
      case "get_file_contents": {
        const { owner, repo, path, ref } = GetFileContentsSchema.parse(args);
        const response = await codebergClient.get(
          `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${encodeURIComponent(path)}`,
          { params: { ref } }
        );

        // Codeberg returns base64 content
        const content = Buffer.from(response.data.content, "base64").toString("utf8");

        return {
          content: [
            {
              type: "text",
              text: content,
            },
          ],
        };
      }

      case "create_or_update_file": {
        const { owner, repo, path, content, ...body } = CreateOrUpdateFileSchema.parse(args);
        // Encode content to base64
        const base64Content = Buffer.from(content).toString("base64");

        const response = await codebergClient.post(
          `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${encodeURIComponent(path)}`,
          {
            ...body,
            content: base64Content,
          }
        );
        return {
          content: [
            {
              type: "text",
              text: `File ${path} ${body.sha ? "updated" : "created"} successfully.`,
            },
          ],
        };
      }

      case "delete_file": {
        const { owner, repo, path, ...body } = DeleteFileSchema.parse(args);
        await codebergClient.delete(
          `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${encodeURIComponent(path)}`,
          { data: body }
        );
        return {
          content: [
            {
              type: "text",
              text: `File ${path} deleted successfully.`,
            },
          ],
        };
      }

      // Search Handlers
      case "search_repositories": {
        const { q, limit, page } = SearchRepositoriesSchema.parse(args);
        const response = await codebergClient.get("/repos/search", {
          params: { q, limit, page },
        });

        const formattedRepos = response.data.data
          ?.map((repo: any) => {
            return `${repo.full_name}
Description: ${repo.description || "No description"}
⭐ ${repo.stars_count} | URL: ${repo.html_url}`;
          })
          .join("\n\n");

        return {
          content: [
            {
              type: "text",
              text: `Total matches: ${response.data.total_count || 0}\n\n${formattedRepos || "No repositories found"}`,
            },
          ],
        };
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error: any) {
    const errorMessage = error.response?.data?.message || error.message;
    throw new Error(`Codeberg API Error: ${errorMessage}`);
  }
}
