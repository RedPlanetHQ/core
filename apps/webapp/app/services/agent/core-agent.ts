import { type Tool, tool, readUIMessageStream, type UIMessage } from "ai";
import { z } from "zod";

import { runOrchestrator } from "./orchestrator";
import { type SkillRef } from "./types";

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
  readOnly: boolean = false,
  persona?: string,
  skills?: SkillRef[],
  /** Optional callback for channels to send intermediate messages (acks) */
  onMessage?: (message: string) => Promise<void>,
  /** Default channel for reminders when source is not whatsapp/slack */
  defaultChannel?: "whatsapp" | "slack" | "email",
  /** Available channels for reminders */
  availableChannels?: Array<"whatsapp" | "slack" | "email">,
) => {
  const tools: Record<string, Tool> = {
    gather_context: tool({
      description: `Search memory, connected integrations, the web, AND connected gateways (user's devices like Claude Code, browser, etc.). This is how you access information.

      FOUR DATA SOURCES:
      1. Memory: past conversations, decisions, user preferences
      2. Integrations: user's emails, calendar, issues, messages (their personal data)
      3. Web: news, current events, documentation, prices, weather, general knowledge, AND reading URLs
      4. Gateways: user's connected devices/agents (e.g., Claude Code on their laptop, browser agent) - use for tasks on their machine

      WHEN TO USE:
      - Before saying "i don't know" - you might know it
      - When user asks about past conversations, decisions, preferences
      - When user asks about live data (emails, calendar, issues, etc.)
      - When user asks about news, current events, how-tos, or general questions
      - When user shares a URL and wants you to read/summarize it
      - When user asks to do something on their device/machine (coding tasks, file operations, browser actions)

      HOW TO FORM YOUR QUERY:
      Describe your INTENT clearly. Include any URLs the user shared.

      EXAMPLES:
      - "What meetings does user have this week" → integrations (calendar)
      - "What did we discuss about the deployment" → memory
      - "Latest tech news and AI updates" → web search
      - "What's the weather in SF" → web search
      - "Summarize this article: https://example.com/post" → web (fetches URL)
      - "User's unread emails from GitHub" → integrations (gmail)
      - "Check the status of user's local dev server" → gateway (connected device)

      For URLs: include the full URL in your query.
      For GENERAL NEWS/INFO: the orchestrator will use web search.
      For USER-SPECIFIC data: it uses integrations.
      For DEVICE/MACHINE tasks: it uses gateways.
      For SKILLS: when user's request matches an available skill, include the skill name and ID in your query so the orchestrator can load and execute it. Example: "Execute skill 'Plan My Day' (skill_id: abc123)"`,
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
          skills,
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
  };

  if (!readOnly) {
    tools["take_action"] = tool({
      description: `Execute actions on user's connected integrations AND gateways (connected devices).
      Use this to CREATE/SEND/UPDATE/DELETE: gmail filters/labels, calendar events, github issues, slack messages, notion pages.
      Also use this for tasks on user's connected devices/agents: coding tasks via Claude Code, browser actions, file operations on their machine.
      Examples: "post message to slack #team-updates saying deployment complete", "block friday 3pm on calendar for 1:1 with sarah", "create github issue in core repo titled fix auth timeout", "fix the auth bug in the core repo" (gateway task)
      When user confirms they want something done, use this tool to do it.
      For SKILLS: when executing a skill, include the skill name and ID. Example: "Execute skill 'Plan My Day' (skill_id: abc123)"`,
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
          skills,
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
    });
  }

  // Add acknowledge tool for channels with intermediate message support
  if (onMessage) {
    tools["acknowledge"] = tool({
      description:
        "Send a quick ack ONLY when you're about to call gather_context or take_action. Do NOT call this for simple greetings, thanks, or conversational messages - just respond directly for those.",
      inputSchema: z.object({
        message: z
          .string()
          .describe(
            'Brief ack referencing what you\'re about to look up. "checking your calendar." "pulling up your emails." "looking at your PRs." "on it." Keep it contextual.',
          ),
      }),
      execute: async ({ message }) => {
        logger.info(`Core brain: Acknowledging: ${message}`);
        await onMessage(message);
        return "acknowledged";
      },
    });
  }

  // Add reminder management tools
  // WhatsApp/Slack source → same channel, everything else → use defaultChannel or email
  const channel =
    source === "whatsapp"
      ? "whatsapp"
      : source === "slack"
        ? "slack"
        : defaultChannel || "email";
  const reminderTools = getReminderTools(
    workspaceId,
    channel,
    timezone,
    availableChannels || ["email"]
  );

  return { ...tools, ...reminderTools };
};
