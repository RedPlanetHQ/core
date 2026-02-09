import { streamText, type LanguageModel, stepCountIs, tool } from "ai";
import { z } from "zod";

import Exa from "exa-js";
import { logger } from "~/services/logger.service";
import { env } from "~/env.server";
import { getModel, getModelForTask } from "~/lib/model.server";

const WEB_COMPLEXITY = "high";

const getWebExplorerPrompt = (timezone: string = "UTC") => {
  const today = new Date().toLocaleDateString("en-CA", { timeZone: timezone });

  return `You are a Web Explorer. Search the web OR read specific URLs.

TODAY: ${today} (${timezone})

TOOLS:
- web_search: Search the web for information. Returns titles, URLs, and snippets.
- get_page_contents: Get full content from specific URLs. Use for URLs shared by user or when you need more detail from search results.

TWO MODES:

1. URL PROVIDED: If the query contains a URL (http:// or https://), use get_page_contents directly.
   - "summarize https://example.com/article" → get_page_contents(["https://example.com/article"])
   - "what does this say: https://blog.com/post" → get_page_contents(["https://blog.com/post"])

2. SEARCH NEEDED: If no URL provided, search first then optionally fetch full content.
   - "latest AI news" → web_search("latest AI news")
   - "how to use React hooks" → web_search("React hooks tutorial")

EXECUTION:
1. Check if query contains a URL → use get_page_contents directly
2. Otherwise, search with a clear query
3. If snippets are sufficient, return the answer
4. If you need more detail, use get_page_contents on relevant URLs
5. Synthesize and return the key facts

RULES:
- Facts only. No personality.
- Cite sources when relevant (include URLs).
- If search returns nothing useful, say so.
- For URLs: extract and summarize the main content.`;
};

export async function runWebExplorer(
  query: string,
  timezone: string = "UTC",
): Promise<ExplorerResult> {
  const startTime = Date.now();
  let toolCalls = 0;

  const exaApiKey = env.EXA_API_KEY;
  if (!exaApiKey) {
    logger.warn("EXA_API_KEY not configured, web search unavailable");
    return {
      success: false,
      data: "",
      error: "Web search not configured",
      metadata: { executionTimeMs: Date.now() - startTime, toolCalls: 0 },
    };
  }

  const exa = new Exa(exaApiKey);

  const tools = {
    web_search: tool({
      description:
        "Search the web for information. Returns titles, URLs, and text snippets.",
      inputSchema: z.object({
        query: z.string().describe("Search query - be specific and clear"),
        numResults: z
          .number()
          .min(1)
          .max(10)
          .default(5)
          .describe("Number of results to return (1-10)"),
        useAutoprompt: z
          .boolean()
          .default(true)
          .describe("Let Exa enhance the query for better results"),
      }),
      execute: async ({ query, numResults, useAutoprompt }) => {
        toolCalls++;
        logger.info(`WebExplorer: searching - ${query}`);
        try {
          const results = await exa.searchAndContents(query, {
            numResults: numResults || 5,
            useAutoprompt: useAutoprompt ?? true,
            text: { maxCharacters: 1000 },
            highlights: true,
          });

          if (!results.results || results.results.length === 0) {
            return "No results found";
          }

          return results.results
            .map((r, i) => {
              const highlights = r.highlights?.join(" ... ") || "";
              const text = r.text?.substring(0, 500) || "";
              return `[${i + 1}] ${r.title || "Untitled"}
URL: ${r.url}
${highlights || text}`;
            })
            .join("\n\n");
        } catch (error: any) {
          logger.error("Exa search failed", error);
          return `Search failed: ${error instanceof Error ? error.message : "unknown error"}`;
        }
      },
    }),

    get_page_contents: tool({
      description:
        "Get full content from specific URLs. Use when search snippets aren't enough.",
      inputSchema: z.object({
        urls: z
          .array(z.string().url())
          .min(1)
          .max(3)
          .describe("URLs to fetch content from (max 3)"),
      }),
      execute: async ({ urls }) => {
        toolCalls++;
        logger.info(`WebExplorer: fetching contents - ${urls.join(", ")}`);
        try {
          const results = await exa.getContents(urls, {
            text: { maxCharacters: 3000 },
          });

          if (!results.results || results.results.length === 0) {
            return "Could not fetch content from URLs";
          }

          return results.results
            .map((r) => {
              return `## ${r.title || "Untitled"}
URL: ${r.url}

${r.text || "No content available"}`;
            })
            .join("\n\n---\n\n");
        } catch (error: any) {
          logger.error("Exa getContents failed", error);
          return `Failed to fetch content: ${error instanceof Error ? error.message : "unknown error"}`;
        }
      },
    }),
  };

  try {
    let model = getModelForTask(WEB_COMPLEXITY);
    logger.info(`complexity: ${WEB_COMPLEXITY}, model: ${model}`);

    const modelInstance = getModel(model);

    const { text } = await generateText({
      model: modelInstance as LanguageModel,
      system: getWebExplorerPrompt(timezone),
      messages: [{ role: "user", content: query }],
      tools,
      stopWhen: stepCountIs(6),
    });

    logger.info("WebExplorer completed", {
      executionTimeMs: Date.now() - startTime,
      toolCalls,
    });

    return {
      success: true,
      data: text,
      metadata: {
        executionTimeMs: Date.now() - startTime,
        toolCalls,
      },
    };
  } catch (error: any) {
    logger.error("WebExplorer failed", error);
    return {
      success: false,
      data: "",
      error: error instanceof Error ? error.message : String(error),
      metadata: {
        executionTimeMs: Date.now() - startTime,
        toolCalls,
      },
    };
  }
}
