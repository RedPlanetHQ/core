import { z } from "zod";
import { createActionApiRoute } from "~/services/routeBuilders/apiBuilder.server";
import { makeModelCall } from "~/lib/model.server";
import { json } from "@remix-run/node";
import type { CoreMessage } from "ai";
import * as cheerio from "cheerio";

export const ExtensionSummaryBodyRequest = z.object({
  html: z.string().min(1, "HTML content is required"),
  url: z.string().url("Valid URL is required"),
  title: z.string().optional(),
});

export type PageType = "text" | "video";

interface ContentExtractionResult {
  pageType: PageType;
  title: string;
  content: string;
  metadata: {
    url: string;
    wordCount: number;
  };
  supported: boolean;
}

/**
 * Detect if page contains video content
 */
function isVideoPage(url: string, $: cheerio.CheerioAPI): boolean {
  const hostname = new URL(url).hostname.toLowerCase();

  // Known video platforms
  if (
    hostname.includes("youtube.com") ||
    hostname.includes("youtu.be") ||
    hostname.includes("vimeo.com") ||
    hostname.includes("twitch.tv") ||
    hostname.includes("tiktok.com")
  ) {
    return true;
  }

  // Generic video content detection
  const videoElements = $("video").length;
  const videoPlayers = $(
    '.video-player, [class*="video-player"], [data-testid*="video"]',
  ).length;

  // If there are multiple video indicators, likely a video-focused page
  return videoElements > 0 || videoPlayers > 2;
}

/**
 * Extract all text content from any webpage
 */
function extractTextContent(
  $: cheerio.CheerioAPI,
  url: string,
): ContentExtractionResult {
  // Extract title from multiple possible locations
  const title =
    $("title").text() ||
    $('meta[property="og:title"]').attr("content") ||
    $('meta[name="title"]').attr("content") ||
    $("h1").first().text() ||
    "Untitled Page";

  // Check if this is primarily a video page
  const isVideo = isVideoPage(url, $);
  const pageType: PageType = isVideo ? "video" : "text";

  let content = "";

  if (isVideo) {
    // For video pages, try to get description/transcript text
    content =
      $("#description, .video-description, .description").text() ||
      $('meta[name="description"]').attr("content") ||
      $('[class*="transcript"], [class*="caption"]').text() ||
      "Video content detected - text summarization not available";
  } else {
    // Simple universal text extraction
    // Remove non-content elements
    $("script, style, noscript, nav, header, footer").remove();

    // Get all text content
    const allText = $("body").text();

    // Split into sentences and filter for meaningful content
    const sentences = allText
      .split(/[.!?]+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 20) // Keep sentences with substance
      .filter(
        (s) =>
          !/^(click|menu|button|nav|home|search|login|signup|subscribe)$/i.test(
            s.toLowerCase(),
          ),
      ) // Remove UI text
      .filter((s) => s.split(" ").length > 3); // Keep sentences with multiple words

    content = sentences.join(". ").slice(0, 10000);
  }

  // Clean up whitespace and normalize text
  content = content.replace(/\s+/g, " ").trim();

  const wordCount = content
    .split(/\s+/)
    .filter((word) => word.length > 0).length;
  const supported = !isVideo && content.length > 50;

  return {
    pageType,
    title: title.trim(),
    content: content.slice(0, 10000), // Limit content size for processing
    metadata: {
      url,
      wordCount,
    },
    supported,
  };
}

/**
 * Generate summary using LLM
 */
async function generateSummary(
  title: string,
  content: string,
): Promise<string> {
  const messages: CoreMessage[] = [
    {
      role: "system",
      content: `You are a helpful assistant that creates concise summaries of web content in HTML format.

Create a clear, informative summary that captures the key points and main ideas from the provided content. The summary should:
- Focus on the most important information and key takeaways
- Be concise but comprehensive
- Maintain the original context and meaning
- Be useful for someone who wants to quickly understand the content
- Format the summary in HTML, using appropriate tags like <h1>, <p>, <ul>, <li> to structure the information

Extract the essential information while preserving important details, facts, or insights.`,
    },
    {
      role: "user",
      content: `Title: ${title}
Content: ${content}

Please provide a concise summary of this content in HTML format.`,
    },
  ];

  try {
    const response = await makeModelCall(
      false,
      messages,
      () => {}, // onFinish callback
      { temperature: 0.3 },
    );

    return response as string;
  } catch (error) {
    console.error("Error generating summary:", error);
    return "<p>Unable to generate summary at this time.</p>";
  }
}

const { action, loader } = createActionApiRoute(
  {
    body: ExtensionSummaryBodyRequest,
    allowJWT: true,
    authorization: {
      action: "search",
    },
    corsStrategy: "all",
  },
  async ({ body }) => {
    try {
      const $ = cheerio.load(body.html);

      // Extract content from any webpage
      const extraction = extractTextContent($, body.url);

      // Override title if provided
      if (body.title) {
        extraction.title = body.title;
      }

      let summary = "";

      if (extraction.supported && extraction.content.length > 0) {
        // Generate summary for text content
        summary = await generateSummary(extraction.title, extraction.content);
      } else {
        // Handle unsupported content types
        if (extraction.pageType === "video") {
          summary =
            "Video content detected. Text summarization not available for video-focused pages.";
        } else {
          summary =
            "Unable to extract sufficient text content for summarization.";
        }
      }

      const response = {
        success: true,
        pageType: extraction.pageType,
        title: extraction.title,
        summary,
        content: extraction.content.slice(0, 1000), // Return first 1000 chars of content
        supported: extraction.supported,
        metadata: extraction.metadata,
      };

      return json(response);
    } catch (error) {
      console.error("Error processing extension summary request:", error);

      return json(
        {
          success: false,
          error: "Failed to process page content",
          pageType: "text" as PageType,
          title: body.title || "Error",
          summary: "Unable to process this page content.",
          content: "",
          supported: false,
          metadata: {
            url: body.url,
            wordCount: 0,
          },
        },
        { status: 500 },
      );
    }
  },
);

export { action, loader };
