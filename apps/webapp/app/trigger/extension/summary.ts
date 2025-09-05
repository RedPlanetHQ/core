import { metadata, task } from "@trigger.dev/sdk";
import { type CoreMessage } from "ai";
import * as cheerio from "cheerio";
import { z } from "zod";
import { makeModelCall } from "~/lib/model.server";
import { summarizeImage, extractImageUrls } from "./utils";

export type PageType = "text" | "video";

export const ExtensionSummaryBodyRequest = z.object({
  html: z.string().min(1, "HTML content is required"),
  url: z.string().url("Valid URL is required"),
  title: z.string().optional(),
  parseImages: z.boolean().default(false),
  apiKey: z.string().optional(),
});

interface ContentExtractionResult {
  pageType: PageType;
  title: string;
  content: string;
  images: string[];
  metadata: {
    url: string;
    wordCount: number;
    imageCount: number;
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
 * Extract all text content and images from any webpage
 */
function extractTextContent(
  $: cheerio.CheerioAPI,
  url: string,
  html: string,
  parseImages: boolean = false,
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

  // Extract images if requested
  const images = parseImages ? extractImageUrls(html) : [];

  const wordCount = content
    .split(/\s+/)
    .filter((word) => word.length > 0).length;
  const supported = !isVideo && (content.length > 50 || images.length > 0);

  return {
    pageType,
    title: title.trim(),
    content: content.slice(0, 10000), // Limit content size for processing
    images,
    metadata: {
      url,
      wordCount,
      imageCount: images.length,
    },
    supported,
  };
}

/**
 * Process images and get their summaries
 */
async function processImages(
  images: string[],
  apiKey?: string,
): Promise<string[]> {
  if (images.length === 0) return [];

  const imageSummaries: string[] = [];

  for (const imageUrl of images) {
    try {
      const summary = await summarizeImage(imageUrl, apiKey);
      imageSummaries.push(`[Image Description]: ${summary}`);
    } catch (error) {
      console.error(`Error processing image ${imageUrl}:`, error);
      imageSummaries.push(
        `[Image Description]: Unable to analyze image at ${imageUrl}`,
      );
    }
  }

  return imageSummaries;
}

/**
 * Generate summary using LLM with optional image descriptions
 */
async function generateSummary(
  title: string,
  content: string,
  imageSummaries: string[] = [],
) {
  // Combine content with image descriptions
  const contentWithImages =
    imageSummaries.length > 0
      ? `${content}\n\n${imageSummaries.join("\n\n")}`
      : content;

  const messages: CoreMessage[] = [
    {
      role: "system",
      content: `You are a helpful assistant that creates concise summaries of web content in HTML format.

Create a clear, informative summary that captures the key points and main ideas from the provided content. The summary should:
- Focus on the most important information and key takeaways
- Be concise but comprehensive
- Maintain the original context and meaning
- Be useful for someone who wants to quickly understand the content
- Format the summary in clean HTML using appropriate tags like <h1>, <h2>, <p>, <ul>, <li> to structure the information
- When image descriptions are provided, integrate them naturally into the summary context
- Replace image references with their detailed descriptions

IMPORTANT: Return ONLY the HTML content without any markdown code blocks or formatting. Do not wrap the response in \`\`\`html or any other markdown syntax. Return the raw HTML directly.

Extract the essential information while preserving important details, facts, or insights. If image descriptions are included, weave them seamlessly into the narrative.`,
    },
    {
      role: "user",
      content: `Title: ${title}
Content: ${contentWithImages}

Please provide a concise summary of this content in HTML format.`,
    },
  ];

  return await makeModelCall(
    true,
    messages,
    () => {}, // onFinish callback
    { temperature: 0.3 },
  );
}

export const extensionSummary = task({
  id: "extensionSummary",
  maxDuration: 3000,
  run: async (body: z.infer<typeof ExtensionSummaryBodyRequest>) => {
    try {
      const $ = cheerio.load(body.html);

      // Extract content from any webpage
      const extraction = extractTextContent(
        $,
        body.url,
        body.html,
        body.parseImages,
      );

      // Override title if provided
      if (body.title) {
        extraction.title = body.title;
      }

      let summary = "";
      let imageSummaries: string[] = [];

      if (extraction.supported) {
        // Process images if requested and available
        if (body.parseImages && extraction.images.length > 0) {
          imageSummaries = await processImages(extraction.images, body.apiKey);
        }

        // Generate summary for text content with image descriptions
        if (extraction.content.length > 0 || imageSummaries.length > 0) {
          const response = (await generateSummary(
            extraction.title,
            extraction.content,
            imageSummaries,
          )) as any;

          const stream = await metadata.stream("messages", response.textStream);

          let finalText: string = "";
          for await (const chunk of stream) {
            finalText = finalText + chunk;
          }

          summary = finalText;
        } else {
          summary = "Unable to extract sufficient content for summarization.";
        }
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
        images: extraction.images,
        imageSummaries: imageSummaries.length > 0 ? imageSummaries : undefined,
        supported: extraction.supported,
        metadata: extraction.metadata,
      };

      return response;
    } catch (error) {
      console.error("Error processing extension summary request:", error);

      return {
        success: false,
        error: "Failed to process page content",
        pageType: "text" as PageType,
        title: body.title || "Error",
        summary: "Unable to process this page content.",
        content: "",
        images: [],
        supported: false,
        metadata: {
          url: body.url,
          wordCount: 0,
          imageCount: 0,
        },
      };
    }
  },
});
