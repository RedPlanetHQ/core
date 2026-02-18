import { type Tool, tool, readUIMessageStream, type UIMessage } from "ai";
import { z } from "zod";

import { runOrchestrator } from "./orchestrator";

import { logger } from "../logger.service";
import { getReminderTools } from "./tools/reminder-tools";

/**
 * Recursively checks if a message contains any tool part with state "approval-requested"
 */
const hasApprovalRequested = (message: UIMessage): boolean => {
  const checkParts = (parts: any[]): boolean => {
    for (const part of parts) {
      if (part.state === "approval-requested") {
        return true;
      }
      // Check nested output.parts (sub-agent responses)
      if (part.output?.parts && Array.isArray(part.output.parts)) {
        if (checkParts(part.output.parts)) return true;
      }
      // Check nested output.content
      if (part.output?.content && Array.isArray(part.output.content)) {
        if (checkParts(part.output.content)) return true;
      }
    }
    return false;
  };

  return message.parts ? checkParts(message.parts) : false;
};

export const createTools = async (
  userId: string,
  workspaceId: string,
  timezone: string,
  source: string,
  persona?: string,
) => {
  const tools: Record<string, Tool> = {
    gather_context: tool({
      description: `Search memory, connected integrations, AND the web. This is how you access information.

      THREE DATA SOURCES:
      1. Memory: past conversations, decisions, user preferences
      2. Integrations: user's emails, calendar, issues, messages (their personal data)
      3. Web: news, current events, documentation, prices, weather, general knowledge, AND reading URLs

      WHEN TO USE:
      - Before saying "i don't know" - you might know it
      - When user asks about past conversations, decisions, preferences
      - When user asks about live data (emails, calendar, issues, etc.)
      - When user asks about news, current events, how-tos, or general questions
      - When user shares a URL and wants you to read/summarize it

      HOW TO FORM YOUR QUERY:
      Describe your INTENT clearly. Include any URLs the user shared.

      EXAMPLES:
      - "What meetings does user have this week" → integrations (calendar)
      - "What did we discuss about the deployment" → memory
      - "Latest tech news and AI updates" → web search
      - "What's the weather in SF" → web search
      - "Summarize this article: https://example.com/post" → web (fetches URL)
      - "User's unread emails from GitHub" → integrations (gmail)

      For URLs: include the full URL in your query.
      For GENERAL NEWS/INFO: the orchestrator will use web search.
      For USER-SPECIFIC data: it uses integrations.`,
      inputSchema: z.object({
        query: z
          .string()
          .describe(
            "Your intent - what you're looking for and why. Describe it like you're asking a colleague to find something.",
          ),
      }),

      execute: async function* ({ query }, { abortSignal }) {
        logger.info(`Core brain: Gathering context for: ${query}`);

        const { stream } = await runOrchestrator(
          userId,
          workspaceId,
          query,
          "read",
          timezone,
          source,
          abortSignal,
          persona,
        );

        // Stream the orchestrator's work to the UI
        let approvalRequested = false;
        for await (const message of readUIMessageStream({
          stream: stream.toUIMessageStream(),
        })) {
          // Skip yielding if we already detected approval (but consume stream to avoid errors)
          if (approvalRequested) {
            continue;
          }

          yield message;

          // Check if this message has approval requested
          if (hasApprovalRequested(message)) {
            logger.info(
              `Core brain: Stopping gather_context - approval requested`,
            );
            approvalRequested = true;
          }
        }
      },
    }),
    take_action: tool({
      description: `Execute actions on user's connected integrations.
      Use this to CREATE/SEND/UPDATE/DELETE: gmail filters/labels, calendar events, github issues, slack messages, notion pages.
      Examples: "post message to slack #team-updates saying deployment complete", "block friday 3pm on calendar for 1:1 with sarah", "create github issue in core repo titled fix auth timeout"
      When user confirms they want something done, use this tool to do it.`,
      inputSchema: z.object({
        action: z
          .string()
          .describe(
            "The action to perform. Be specific: include integration, what to create/send/update, and all details.",
          ),
      }),
      execute: async function* ({ action }, { abortSignal }) {
        logger.info(`Core brain: Taking action: ${action}`);

        const { stream } = await runOrchestrator(
          userId,
          workspaceId,
          action,
          "write",
          timezone,
          source,
          abortSignal,
          persona,
        );

        // Stream the orchestrator's work to the UI
        let approvalRequested = false;
        for await (const message of readUIMessageStream({
          stream: stream.toUIMessageStream(),
        })) {
          // Skip yielding if we already detected approval (but consume stream to avoid errors)
          if (approvalRequested) {
            continue;
          }

          yield message;

          // Check if this message has approval requested
          if (hasApprovalRequested(message)) {
            logger.info(
              `Core brain: Stopping take_action - approval requested`,
            );
            approvalRequested = true;
          }
        }
      },
    }),
  };

  // Add reminder management tools
  // WhatsApp source → whatsapp, everything else (web/email) → email
  const channel = source === "whatsapp" ? "whatsapp" : "email";
  const reminderTools = getReminderTools(workspaceId, channel, timezone);

  return { ...tools, ...reminderTools };
};
