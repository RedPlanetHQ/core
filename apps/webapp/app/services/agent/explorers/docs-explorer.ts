import Exa from "exa-js";
import { logger } from "~/services/logger.service";
import { env } from "~/env.server";
import { type ExplorerResult } from "../types";

const DOCS_MCP_URL = "https://docs.getcore.me/mcp";
const DOCS_BASE_URL = "https://docs.getcore.me";
const MAX_PAGES_TO_FETCH = 3;

interface DocSearchEntry {
  title: string;
  link: string;
  snippet: string;
}

/**
 * Parse a Mintlify MCP text entry like:
 * "Title: Toolkit Overview\nLink: https://docs.getcore.me/toolkit/overview\nContent: ..."
 */
function parseSearchEntry(text: string): DocSearchEntry {
  const titleMatch = text.match(/^Title:\s*(.+)/m);
  const linkMatch = text.match(/^Link:\s*(https?:\/\/\S+)/m);
  const contentMatch = text.match(/^Content:\s*([\s\S]*)/m);

  return {
    title: titleMatch?.[1]?.trim() || "Untitled",
    link: linkMatch?.[1]?.trim() || "",
    snippet: (contentMatch?.[1]?.trim() || text).replace(/<[^>]+>/g, ""),
  };
}

/**
 * Fetch full page content for a list of URLs using Exa.
 * Returns clean text content without HTML noise.
 */
async function fetchPageContents(
  urls: string[],
): Promise<Map<string, string>> {
  const contentMap = new Map<string, string>();

  const exaApiKey = env.EXA_API_KEY;
  if (!exaApiKey || urls.length === 0) return contentMap;

  try {
    const exa = new Exa(exaApiKey);
    const results = await exa.getContents(urls, {
      text: { maxCharacters: 4000 },
    });

    for (const result of results.results) {
      if (result.url && result.text) {
        contentMap.set(result.url, result.text);
      }
    }
  } catch (error) {
    logger.warn("DocsExplorer: Exa getContents failed, falling back to snippets", { error });
  }

  return contentMap;
}

interface McpToolResult {
  content: Array<{ type: string; text?: string }>;
}

/**
 * Search CORE documentation via Mintlify's MCP endpoint,
 * then fetch full content from the top matching pages using Exa.
 */
export async function searchCoreDocs(
  query: string,
): Promise<ExplorerResult> {
  const startTime = Date.now();

  try {
    // Step 1: Search via MCP
    const response = await fetch(DOCS_MCP_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: {
          name: "search_core_documentation",
          arguments: { query },
        },
      }),
    });

    if (!response.ok) {
      logger.warn(`Docs MCP returned ${response.status}`);
      return {
        success: false,
        data: "",
        error: `Docs search failed with status ${response.status}`,
        metadata: { executionTimeMs: Date.now() - startTime },
      };
    }

    const contentType = response.headers.get("content-type") || "";

    let result: McpToolResult;

    if (contentType.includes("text/event-stream")) {
      const text = await response.text();
      const dataLine = text
        .split("\n")
        .find((line) => line.startsWith("data: "));
      if (!dataLine) {
        return {
          success: false,
          data: "",
          error: "No data in SSE response",
          metadata: { executionTimeMs: Date.now() - startTime },
        };
      }
      const parsed = JSON.parse(dataLine.slice(6));
      result = parsed.result ?? parsed;
    } else {
      const parsed = await response.json();
      result = parsed.result ?? parsed;
    }

    if (!result?.content?.length) {
      return {
        success: true,
        data: "No documentation found for this query.",
        metadata: { executionTimeMs: Date.now() - startTime },
      };
    }

    // Step 2: Parse search results
    const entries = result.content
      .filter((c) => c.type === "text" && c.text)
      .map((c) => parseSearchEntry(c.text!));

    // Deduplicate by base URL (strip fragment anchors)
    const uniqueEntries = entries.reduce<DocSearchEntry[]>((acc, entry) => {
      const baseLink = entry.link.split("#")[0];
      if (baseLink && !acc.some((e) => e.link.split("#")[0] === baseLink)) {
        acc.push(entry);
      }
      return acc;
    }, []);

    // Step 3: Fetch full content from top pages using Exa
    const topEntries = uniqueEntries.slice(0, MAX_PAGES_TO_FETCH);
    const urls = topEntries.map((e) => e.link.split("#")[0]);
    const pageContents = await fetchPageContents(urls);

    // Step 4: Format output for the LLM
    const formattedResults = topEntries
      .map((page, i) => {
        const baseUrl = page.link.split("#")[0];
        const content = pageContents.get(baseUrl) || page.snippet;
        return `[${i + 1}] ${page.title}\nURL: ${page.link}\n\n${content}`;
      })
      .join("\n\n---\n\n");

    // Include remaining entries as brief references
    const remaining = uniqueEntries.slice(MAX_PAGES_TO_FETCH);
    const references = remaining.length
      ? "\n\n---\nOther relevant pages:\n" +
        remaining
          .map((e) => `- ${e.title}: ${e.link}`)
          .join("\n")
      : "";

    const output = formattedResults + references;

    logger.info("DocsExplorer completed", {
      executionTimeMs: Date.now() - startTime,
      query,
      pagesFound: uniqueEntries.length,
      pagesFetched: topEntries.length,
    });

    return {
      success: true,
      data: output,
      metadata: { executionTimeMs: Date.now() - startTime },
    };
  } catch (error) {
    logger.error("DocsExplorer failed", { error, query });
    return {
      success: false,
      data: "",
      error: error instanceof Error ? error.message : String(error),
      metadata: { executionTimeMs: Date.now() - startTime },
    };
  }
}

export { DOCS_BASE_URL };
