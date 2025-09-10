import { metadata, task } from "@trigger.dev/sdk";
import { streamText, type CoreMessage, tool } from "ai";
import { z } from "zod";

import { openai } from "@ai-sdk/openai";
import { logger } from "~/services/logger.service";
import {
  deletePersonalAccessToken,
  getOrCreatePersonalAccessToken,
} from "../utils/utils";
import axios from "axios";
import { nanoid } from "nanoid";

export const ExtensionSearchBodyRequest = z.object({
  userInput: z.string().min(1, "User input is required"),
  userId: z.string().min(1, "User ID is required"),
  outputType: z.string().default("markdown"),
  context: z
    .string()
    .optional()
    .describe("Additional context about the user's current work"),
});

// Export a singleton instance
export const extensionSearch = task({
  id: "extensionSearch",
  maxDuration: 3000,
  run: async (body: z.infer<typeof ExtensionSearchBodyRequest>) => {
    const { userInput, userId, context } =
      ExtensionSearchBodyRequest.parse(body);
    const outputType = body.outputType;
    const randomKeyName = `extensionSearch_${nanoid(10)}`;

    const pat = await getOrCreatePersonalAccessToken({
      name: randomKeyName,
      userId: userId as string,
    });

    // Define the searchMemory tool that actually calls the search service
    const searchMemoryTool = tool({
      description:
        "Search the user's memory for relevant facts and episodes based on a query",
      parameters: z.object({
        query: z.string().describe("Search query to find relevant information"),
      }),
      execute: async ({ query }) => {
        try {
          const response = await axios.post(
            `https://core.heysol.ai/api/v1/search`,
            { query },
            {
              headers: {
                Authorization: `Bearer rc_pat_v41311t6trhr3c8sc7ap4hsbhp6pwsstzyunaazq`,
              },
            },
          );
          const searchResult = response.data;

          return {
            facts: searchResult.facts || {},
            episodes: searchResult.episodes || [],
          };
        } catch (error) {
          logger.error(`SearchMemory tool error: ${error}`);
          return {
            facts: [],
            episodes: [],
          };
        }
      },
    });

    const messages: CoreMessage[] = [
      {
        role: "system",
        content: `You are a specialized memory search and summarization agent. Your job is to:

1. FIRST: Understand the user's intent and what information they need to achieve their goal
2. THEN: Design a strategic search plan to gather that information from memory
3. Execute multiple targeted searches using the searchMemory tool
4. Format your response in ${outputType} and return exact content from episodes or facts without modification.

SEARCH STRATEGY:
- Analyze the user's query to understand their underlying intent and information needs
- For comparisons: search each entity separately, then look for comparative information
- For "how to" questions: search for procedures, examples, and related concepts
- For troubleshooting: search for error messages, solutions, and similar issues
- For explanations: search for definitions, examples, and context
- Always use multiple targeted searches with different angles rather than one broad search
- Think about what background knowledge would help answer the user's question

EXAMPLES:
- "Graphiti vs CORE comparison" → Intent: Compare two systems → Search: "Graphiti", "CORE", "Graphiti features", "CORE features"
- "How to implement authentication" → Intent: Learn implementation → Search: "authentication", "authentication implementation", "login system"
- "Why is my build failing" → Intent: Debug issue → Search: "build error", "build failure", "deployment issues"

IMPORTANT: Always format your response in ${outputType}. When you find relevant content in episodes or facts, return the exact content as found - preserve lists, code blocks, formatting, and structure exactly as they appear. Present the information clearly organized in ${outputType} format with appropriate headers and structure.

HANDLING PARTIAL RESULTS:
- If you find complete information for the query, present it organized by topic
- If you find partial information, clearly state what you found and what you didn't find
- Always provide helpful related information even if it doesn't directly answer the query
- Example: "I didn't find specific information about X vs Y comparison, but here's what I found about X: [exact content] and about Y: [exact content], which can help you build the comparison"

If no relevant information is found at all, provide a brief statement indicating that in ${outputType} format.`,
      },
      {
        role: "user",
        content: `User input: "${userInput}"${context ? `\n\nAdditional context: ${context}` : ""}\n\nPlease search my memory for relevant information and provide the exact content from episodes or facts that relate to this question. Format your response in ${outputType} and do not modify or summarize the found content.`,
      },
    ];

    try {
      const result = streamText({
        model: openai(process.env.MODEL as string),
        messages,
        tools: {
          searchMemory: searchMemoryTool,
        },
        maxSteps: 5,
        temperature: 0.3,
        maxTokens: 1000,
      });

      const stream = await metadata.stream("messages", result.textStream);

      let finalText: string = "";
      for await (const chunk of stream) {
        finalText = finalText + chunk;
      }

      await deletePersonalAccessToken(pat?.id);

      return finalText;
    } catch (error) {
      await deletePersonalAccessToken(pat?.id);

      logger.error(`SearchMemoryAgent error: ${error}`);

      return `Context related to: ${userInput}. Looking for relevant background information, previous discussions, and related concepts that would help provide a comprehensive answer.`;
    }
  },
});
