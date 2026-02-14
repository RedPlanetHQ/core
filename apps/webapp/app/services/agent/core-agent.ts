import { type Tool, tool, readUIMessageStream } from "ai";
import { z } from "zod";

import { runOrchestrator } from "./orchestrator";

import { logger } from "../logger.service";
import { createGatewayTools, getGatewayAgents } from "./gateway";

export const createTools = async (
  userId: string,
  workspaceId: string,
  timezone: string,
  source: string,
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
        );

        // Stream the orchestrator's work to the UI
        for await (const message of readUIMessageStream({
          stream: stream.toUIMessageStream(),
        })) {
          yield message;
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
        );

        // Stream the orchestrator's work to the UI
        for await (const message of readUIMessageStream({
          stream: stream.toUIMessageStream(),
        })) {
          yield message;
        }
      },
    }),
  };

  const gatewayAgents = await getGatewayAgents(workspaceId);
  const gatewayTools = createGatewayTools(gatewayAgents);

  console.log({ ...tools, ...gatewayTools });
  return { ...tools, ...gatewayTools };
};
