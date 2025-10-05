/**
 * GitHub Webhook Server for CORE
 *
 * Processes GitHub webhook events (push, PR, reviews, comments) to:
 * 1. Extract AI-generated review comments (CodeRabbit, Copilot, Claude, GPT-4)
 * 2. Trigger code parsing and graph ingestion
 * 3. Link AI reviews to code entities in the knowledge graph
 *
 * Ported from pr-mcp/services/server.py
 */

import crypto from "crypto";
import { logger } from "./logger.service";

export interface WebhookConfig {
  githubWebhookSecret: string;
  githubToken: string;
  reposToTrack: string; // '*' for all, or comma-separated list
  processReviews: boolean;
  processReviewComments: boolean;
  processIssueComments: boolean;
  botPatterns: string[];
  maxConcurrentProcesses: number;
}

export interface GitHubWebhookEvent {
  action: string;
  repository: {
    full_name: string;
    owner: { login: string };
    name: string;
  };
  pull_request?: {
    number: number;
    html_url: string;
    diff_url: string;
    head: { sha: string };
    base: { sha: string };
  };
  review?: {
    body: string;
    user: { login: string };
    state: string;
    html_url: string;
  };
  comment?: {
    body: string;
    user: { login: string };
    html_url: string;
    path?: string;
    line?: number;
    position?: number;
  };
  issue?: {
    number: number;
    pull_request?: any;
  };
}

export interface AIReviewComment {
  author: string; // "CodeRabbit", "Copilot", "Claude", etc.
  body: string;
  suggestion?: string;
  filePath?: string;
  lineNumber?: number;
  prNumber: number;
  repository: string;
  htmlUrl: string;
  eventType: string;
  timestamp: Date;
}

export class GitHubWebhookService {
  private config: WebhookConfig;
  private activeProcesses: Map<string, Date> = new Map();
  private stats = {
    totalWebhooks: 0,
    processedEvents: 0,
    failedEvents: 0,
    activeProcesses: 0,
  };

  constructor(config: WebhookConfig) {
    this.config = config;
  }

  /**
   * Verify GitHub webhook signature using HMAC-SHA256
   * Port of: verify_signature() from server.py
   */
  verifySignature(payload: Buffer, signature: string): boolean {
    if (!signature) {
      return false;
    }

    const expected =
      "sha256=" +
      crypto
        .createHmac("sha256", this.config.githubWebhookSecret)
        .update(payload)
        .digest("hex");

    return crypto.timingSafeEqual(
      Buffer.from(expected),
      Buffer.from(signature)
    );
  }

  /**
   * Check if repository should be processed
   * Port of: should_process_repo() from server.py
   */
  shouldProcessRepo(repoName: string): boolean {
    if (this.config.reposToTrack === "*") {
      return true;
    }
    return this.config.reposToTrack.split(",").includes(repoName);
  }

  /**
   * Check if event should be processed based on type and action
   * Port of: should_process_event() from server.py
   */
  shouldProcessEvent(eventType: string, payload: GitHubWebhookEvent): boolean {
    // Filter by event type
    const eventFilters: Record<string, boolean> = {
      pull_request_review: this.config.processReviews,
      pull_request_review_comment: this.config.processReviewComments,
      issue_comment: this.config.processIssueComments,
    };

    if (!eventFilters[eventType]) {
      return false;
    }

    // Check if it's a PR comment (not issue comment)
    if (eventType === "issue_comment" && !payload.issue?.pull_request) {
      return false;
    }

    // Filter by action
    const action = payload.action || "";
    return ["created", "edited", "submitted"].includes(action);
  }

  /**
   * Check if comment contains relevant AI-generated content
   * Port of: is_relevant_comment() from server.py
   */
  isRelevantComment(commentBody: string, author: string): boolean {
    if (!commentBody) {
      return false;
    }

    // Check for known AI bot patterns
    const aiBots = this.config.botPatterns;

    // Check if comment is from an AI bot
    if (aiBots.includes(author)) {
      return true;
    }

    // Check for relevant content patterns
    const relevantPatterns = [
      "```suggestion",
      "📝 Committable suggestion",
      "🤖 Prompt for AI Agents",
      "```diff",
      "```python",
      "```javascript",
      "```typescript",
      "```go",
      "```java",
      "```csharp",
      "```ruby",
      // Claude patterns
      "I suggest",
      "Consider",
      "You could",
      "Here's a better approach",
      // GPT patterns
      "I recommend",
      "This would be better",
      // CodeRabbit patterns
      "Learnings used",
      "Review comments",
    ];

    return relevantPatterns.some((pattern) =>
      commentBody.toLowerCase().includes(pattern.toLowerCase())
    );
  }

  /**
   * Extract AI review comment data from webhook payload
   */
  extractAIReview(
    eventType: string,
    payload: GitHubWebhookEvent
  ): AIReviewComment | null {
    let commentBody = "";
    let commentAuthor = "";
    let htmlUrl = "";
    let filePath: string | undefined;
    let lineNumber: number | undefined;

    // Extract comment data based on event type
    if (payload.comment) {
      commentBody = payload.comment.body || "";
      commentAuthor = payload.comment.user?.login || "";
      htmlUrl = payload.comment.html_url || "";
      filePath = payload.comment.path;
      lineNumber = payload.comment.line || payload.comment.position;
    } else if (payload.review) {
      commentBody = payload.review.body || "";
      commentAuthor = payload.review.user?.login || "";
      htmlUrl = payload.review.html_url || "";
    }

    if (!this.isRelevantComment(commentBody, commentAuthor)) {
      return null;
    }

    // Get PR number
    const prNumber =
      payload.pull_request?.number || payload.issue?.number || 0;

    if (!prNumber) {
      return null;
    }

    // Extract code suggestions from comment body
    const suggestion = this.extractCodeSuggestion(commentBody);

    return {
      author: commentAuthor,
      body: commentBody,
      suggestion,
      filePath,
      lineNumber,
      prNumber,
      repository: payload.repository.full_name,
      htmlUrl,
      eventType,
      timestamp: new Date(),
    };
  }

  /**
   * Extract code suggestion blocks from comment text
   */
  private extractCodeSuggestion(commentBody: string): string | undefined {
    // Look for code suggestions in markdown code blocks
    const suggestionPatterns = [
      /```suggestion\n([\s\S]*?)\n```/g,
      /```diff\n([\s\S]*?)\n```/g,
      /📝 Committable suggestion[\s\S]*?```[\w]*\n([\s\S]*?)\n```/g,
    ];

    for (const pattern of suggestionPatterns) {
      const matches = commentBody.match(pattern);
      if (matches && matches.length > 0) {
        return matches.join("\n\n");
      }
    }

    return undefined;
  }

  /**
   * Process GitHub webhook event
   * Port of: process_webhook_event() from server.py
   */
  async processWebhookEvent(
    eventType: string,
    payload: GitHubWebhookEvent
  ): Promise<AIReviewComment | null> {
    try {
      const repo = payload.repository?.full_name || "";
      if (!repo) {
        logger.warn("No repository found in webhook payload");
        return null;
      }

      if (!this.shouldProcessRepo(repo)) {
        logger.info(`Repository ${repo} not in tracking list`);
        return null;
      }

      if (!this.shouldProcessEvent(eventType, payload)) {
        logger.info(`Event ${eventType} not processed for ${repo}`);
        return null;
      }

      // Extract AI review comment
      const aiReview = this.extractAIReview(eventType, payload);
      if (!aiReview) {
        logger.info(`No relevant AI comment found in ${repo} event`);
        return null;
      }

      this.stats.processedEvents++;
      logger.info(`Extracted AI review from ${repo}#${aiReview.prNumber} by ${aiReview.author}`);

      return aiReview;
    } catch (error) {
      logger.error("Error processing webhook event", { error });
      this.stats.failedEvents++;
      return null;
    }
  }

  /**
   * Get webhook processing statistics
   */
  getStats() {
    return {
      ...this.stats,
      activeProcesses: this.activeProcesses.size,
    };
  }
}

/**
 * Create webhook service with environment-based configuration
 */
export function createGitHubWebhookService(): GitHubWebhookService {
  const config: WebhookConfig = {
    githubWebhookSecret: process.env.GITHUB_WEBHOOK_SECRET || "",
    githubToken: process.env.GITHUB_TOKEN || "",
    reposToTrack: process.env.REPOS_TO_TRACK || "*",
    processReviews: process.env.PROCESS_REVIEWS !== "false",
    processReviewComments: process.env.PROCESS_REVIEW_COMMENTS !== "false",
    processIssueComments: process.env.PROCESS_ISSUE_COMMENTS !== "false",
    botPatterns: (
      process.env.BOT_PATTERNS ||
      "coderabbitai[bot],copilot-pull-request-reviewer[bot],Copilot,Claude,GPT-4"
    ).split(","),
    maxConcurrentProcesses: parseInt(
      process.env.WEBHOOK_MAX_CONCURRENT_PROCESSES || "5",
      10
    ),
  };

  return new GitHubWebhookService(config);
}
