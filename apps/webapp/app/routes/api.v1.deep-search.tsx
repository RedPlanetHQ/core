import { z } from "zod";
import { json } from "@remix-run/node";
import { createActionApiRoute } from "~/services/routeBuilders/apiBuilder.server";
import { trackFeatureUsage } from "~/services/telemetry.server";
import { nanoid } from "nanoid";
import {
  deletePersonalAccessToken,
  getOrCreatePersonalAccessToken,
} from "~/services/personalAccessToken.server";

import {
  convertToModelMessages,
  type CoreMessage,
  generateText,
  type LanguageModel,
  streamText,
  tool,
  validateUIMessages,
} from "ai";
import axios from "axios";
import { logger } from "~/services/logger.service";
import { getReActPrompt } from "~/lib/prompt.server";
import { getModel } from "~/lib/model.server";

const DeepSearchBodySchema = z.object({
  content: z.string().min(1, "Content is required"),
  intentOverride: z.string().optional(),
  stream: z.boolean().default(false),
  metadata: z
    .object({
      source: z.enum(["chrome", "obsidian", "mcp"]).optional(),
      url: z.string().optional(),
      pageTitle: z.string().optional(),
    })
    .optional(),
});

export function createSearchMemoryTool(token: string) {
  return tool({
    description:
      "Search the user's memory for relevant facts and episodes. Use this tool multiple times with different queries to gather comprehensive context.",
    parameters: z.object({
      query: z
        .string()
        .describe(
          "Search query to find relevant information. Be specific: entity names, topics, concepts.",
        ),
    }),
    execute: async ({ query }: { query: string }) => {
      try {
        const response = await axios.post(
          `${process.env.API_BASE_URL || "https://core.heysol.ai"}/api/v1/search`,
          { query },
          {
            headers: {
              Authorization: `Bearer ${token}`,
            },
          },
        );

        const searchResult = response.data;

        return {
          facts: searchResult.facts || [],
          episodes: searchResult.episodes || [],
          summary: `Found ${searchResult.episodes?.length || 0} relevant memories`,
        };
      } catch (error) {
        logger.error(`SearchMemory tool error: ${error}`);
        return {
          facts: [],
          episodes: [],
          summary: "No results found",
        };
      }
    },
  } as any);
}

const { action, loader } = createActionApiRoute(
  {
    body: DeepSearchBodySchema,
    method: "POST",
    allowJWT: true,
    authorization: {
      action: "search",
    },
    corsStrategy: "all",
  },
  async ({ body, authentication }) => {
    // Track deep search
    trackFeatureUsage("deep_search_performed", authentication.userId).catch(
      console.error,
    );

    const randomKeyName = `deepSearch_${nanoid(10)}`;

    const pat = await getOrCreatePersonalAccessToken({
      name: randomKeyName,
      userId: authentication.userId as string,
    });

    if (!pat?.token) {
      return json({
        success: false,
        error: "Failed to create personal access token",
      });
    }

    try {
      // Create search tool that agent will use
      const searchTool = createSearchMemoryTool(pat.token);

      const tools = {
        searchMemory: searchTool,
      };
      // Build initial messages with ReAct prompt
      const initialMessages: CoreMessage[] = [
        {
          role: "system",
          content: getReActPrompt(body.metadata, body.intentOverride),
        },
        {
          role: "user",
          content: `CONTENT TO ANALYZE:\n${body.content}\n\nPlease search my memory for relevant context and synthesize what you find.`,
        },
      ];

      const validatedMessages = await validateUIMessages({
        messages: initialMessages,
        tools,
      });

      if (body.stream) {
        const result = streamText({
          model: getModel() as LanguageModel,
          messages: convertToModelMessages(validatedMessages),
        });

        return result.toUIMessageStreamResponse({
          originalMessages: validatedMessages,
        });
      } else {
        const { text } = await generateText({
          model: getModel() as LanguageModel,
          messages: convertToModelMessages(validatedMessages),
        });

        await deletePersonalAccessToken(pat?.id);
        return json({ text });
      }
    } catch (error: any) {
      await deletePersonalAccessToken(pat?.id);
      logger.error(`Deep search error: ${error}`);

      return json({
        success: false,
        error: error.message,
      });
    }
  },
);

export { action, loader };
