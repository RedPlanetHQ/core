import { createGitHubWebhookService } from '../../../apps/webapp/app/services/github-webhook.server';

/**
 * PROCESS Event Handler
 *
 * Handles GitHub webhook events and extracts:
 * 1. AI review comments (immediate)
 * 2. Changed files (for background parsing)
 *
 * Returns message types:
 * - activity: AI review comments
 * - code_parse_job: Queues background code parsing
 */
export async function handleWebhookProcess(eventBody: any, config: any) {
  const webhookService = createGitHubWebhookService(config.webhook_secret);
  const messages: any[] = [];

  const event = eventBody.event;
  const eventType = eventBody.headers?.['x-github-event'];

  if (!event || !eventType) {
    return {
      type: 'error',
      data: { message: 'Missing event or event type' }
    };
  }

  // Extract AI review comment if present
  const aiReview = await webhookService.processWebhookEvent(eventType, event);

  if (aiReview) {
    // Return AI review as activity (immediate)
    messages.push({
      type: 'activity',
      data: {
        title: `AI Review: ${aiReview.author} on ${aiReview.pr_number ? `PR #${aiReview.pr_number}` : aiReview.file_path}`,
        description: aiReview.comment_body,
        metadata: {
          type: 'ai_review',
          author: aiReview.author,
          service: aiReview.service,
          repository: aiReview.repository,
          pr_number: aiReview.pr_number,
          file_path: aiReview.file_path,
          line_number: aiReview.line_number,
          commit_sha: aiReview.commit_sha,
          comment_url: aiReview.comment_url,
          created_at: aiReview.created_at
        }
      }
    });
  }

  // Extract changed files for code parsing
  const changedFiles = extractChangedFiles(eventType, event);

  if (changedFiles.length > 0) {
    // Queue background code parsing job
    messages.push({
      type: 'code_parse_job',
      data: {
        repository: event.repository?.full_name,
        owner: event.repository?.owner?.login,
        repo: event.repository?.name,
        branch: extractBranch(eventType, event),
        commit_sha: extractCommitSha(eventType, event),
        files: changedFiles,
        event_type: eventType,
        pr_number: event.pull_request?.number || null
      }
    });
  }

  return messages;
}

/**
 * Extract changed files from GitHub webhook event
 */
function extractChangedFiles(eventType: string, event: any): Array<{
  path: string;
  status: 'added' | 'modified' | 'removed';
  additions?: number;
  deletions?: number;
}> {
  const files: any[] = [];

  switch (eventType) {
    case 'push':
      // Extract from commits
      if (event.commits && Array.isArray(event.commits)) {
        const allFiles = new Map();

        for (const commit of event.commits) {
          // Added files
          if (commit.added) {
            commit.added.forEach((path: string) => {
              allFiles.set(path, { path, status: 'added' });
            });
          }

          // Modified files
          if (commit.modified) {
            commit.modified.forEach((path: string) => {
              allFiles.set(path, { path, status: 'modified' });
            });
          }

          // Removed files
          if (commit.removed) {
            commit.removed.forEach((path: string) => {
              allFiles.set(path, { path, status: 'removed' });
            });
          }
        }

        files.push(...Array.from(allFiles.values()));
      }
      break;

    case 'pull_request':
      // For PR events, we'll need to fetch the files via API
      // For now, just signal that this PR needs processing
      if (event.pull_request) {
        files.push({
          path: '_PR_FILES_', // Special marker to fetch PR files
          status: 'modified',
          pr_number: event.pull_request.number
        });
      }
      break;

    case 'pull_request_review':
    case 'pull_request_review_comment':
      // These are AI review events, files will be extracted from the review
      if (event.pull_request) {
        files.push({
          path: '_PR_FILES_',
          status: 'modified',
          pr_number: event.pull_request.number
        });
      }
      break;
  }

  return files;
}

/**
 * Extract branch name from event
 */
function extractBranch(eventType: string, event: any): string | null {
  switch (eventType) {
    case 'push':
      // Extract from ref (e.g., "refs/heads/main" -> "main")
      return event.ref?.replace('refs/heads/', '') || null;

    case 'pull_request':
    case 'pull_request_review':
    case 'pull_request_review_comment':
      return event.pull_request?.head?.ref || null;

    default:
      return null;
  }
}

/**
 * Extract commit SHA from event
 */
function extractCommitSha(eventType: string, event: any): string | null {
  switch (eventType) {
    case 'push':
      return event.after || event.head_commit?.id || null;

    case 'pull_request':
    case 'pull_request_review':
    case 'pull_request_review_comment':
      return event.pull_request?.head?.sha || null;

    default:
      return null;
  }
}
