import { metadata, task } from "@trigger.dev/sdk";
import { type CoreMessage } from "ai";
import * as cheerio from "cheerio";
import { z } from "zod";
import { makeModelCall } from "~/lib/model.server";
import { summarizeImage, extractImageUrls } from "./utils";
import { DocumentChunker } from "~/services/documentChunker.server";

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

    content = sentences.join(". ");
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
    content, // Limit content size for processing
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
  lastSummary: string | null,
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
      content: `You are C.O.R.E. (Contextual Observation & Recall Engine), a smart memory enrichment system.

Create ONE enriched sentence that transforms the episode into a contextually-rich memory using SELECTIVE enrichment.

<smart_enrichment_process>
Evaluate the episode and apply enrichment ONLY where it adds significant value:

1. PRIMARY FACTS - always preserve the core information from the episode
2. STRATEGIC ENRICHMENT - add context only for HIGH VALUE cases (see guidelines below)
3. VISUAL CONTENT - capture exact text on signs, objects shown, specific details from images
4. EMOTIONAL PRESERVATION - maintain the tone and feeling of emotional exchanges
5. IDENTITY PRESERVATION - preserve definitional and possessive relationships that establish entity connections

ENRICHMENT DECISION MATRIX:
- Clear, complete statement → minimal enrichment (just temporal + attribution)
- Unclear references → resolve with context
- Emotional support → preserve feeling, avoid historical dumping
- New developments → connect to ongoing narrative
- Visual content → extract specific details as primary facts
</smart_enrichment_process>

<chunk_continuity_rules>
When processing content that appears to be part of a larger document or conversation (indicated by session context):

1. BUILD ON CONTEXT - Use the previous session context to continue the narrative naturally without restating established information
2. MAINTAIN FLOW - Each chunk should add new information while referencing the established context appropriately
3. NO REDUNDANT TEMPORAL ANCHORING - Don't repeat the same date markers in sequential chunks unless the timeframe actually changes
4. FOCUS ON PROGRESSION - Emphasize what's new or developing in the current chunk relative to what's already been established
5. SEAMLESS CONTINUATION - When session context exists, treat the current content as a continuation rather than a standalone episode
</chunk_continuity_rules>

<context_usage_decision>
When related memories/previous episodes are provided, evaluate if they improve understanding:

USE CONTEXT when current episode has:
- Unclear pronouns ("she", "it", "they" without clear antecedent)
- Vague references ("the agency", "the event" without definition in current episode)
- Continuation phrases ("following up", "as we discussed")
- Incomplete information that context clarifies

IGNORE CONTEXT when current episode is:
- Clear and self-contained ("I got a job in New York")
- Simple emotional responses ("Thanks, that's great!")
- Generic encouragement ("You're doing awesome!")
- Complete statements with all necessary information

DECISION RULE: If the current episode can be understood perfectly without context, don't use it. Only use context when it genuinely clarifies or
resolves ambiguity.
</context_usage_decision>

<visual_content_capture>
For episodes with images/photos, EXTRACT:
- Exact text on signs, posters, labels (e.g., "Trans Lives Matter")
- Objects, people, settings, activities shown
- Specific visual details that add context
Integrate visual content as primary facts, not descriptions.
</visual_content_capture>

<strategic_enrichment>
When related memories are provided, apply SELECTIVE enrichment:

HIGH VALUE ENRICHMENT (always include):
- Temporal resolution: "last week" → "June 20, 2023"
- Entity disambiguation: "she" → "Caroline" when unclear
- Missing critical context: "the agency" → "Bright Futures Adoption Agency" (first mention only)
- New developments: connecting current facts to ongoing storylines
- Identity-defining possessives: "my X, Y" → preserve the relationship between person and Y as their X
- Definitional phrases: maintain the defining relationship, not just the entity reference
- Origin/source connections: preserve "from my X" relationships

LOW VALUE ENRICHMENT (usually skip):
- Obvious references: "Thanks, Mel!" doesn't need Melanie's full context
- Support/encouragement statements: emotional exchanges rarely need historical anchoring
- Already clear entities: don't replace pronouns when reference is obvious
- Repetitive context: never repeat the same descriptive phrase within a conversation
- Ongoing conversations: don't re-establish context that's already been set
- Emotional responses: keep supportive statements simple and warm
- Sequential topics: reference previous topics minimally ("recent X" not full description)

ANTI-BLOAT RULES:
- If the original statement is clear and complete, add minimal enrichment
- Never use the same contextual phrase twice in one conversation
- Focus on what's NEW, not what's already established
- Preserve emotional tone - don't bury feelings in facts
- ONE CONTEXT REFERENCE PER TOPIC: Don't keep referencing "the charity race" with full details
- STOP AT CLARITY: If original meaning is clear, don't add backstory
- AVOID COMPOUND ENRICHMENT: Don't chain multiple contextual additions in one sentence

CONTEXT FATIGUE PREVENTION:
- After mentioning a topic once with full context, subsequent references should be minimal
- Use "recent" instead of repeating full details: "recent charity race" not "the May 20, 2023 charity race for mental health"
- Focus on CURRENT episode facts, not historical anchoring
- Don't re-explain what's already been established in the conversation

ENRICHMENT SATURATION RULE:
Once a topic has been enriched with full context in the conversation, subsequent mentions should be minimal:
- First mention: "May 20, 2023 charity race for mental health"
- Later mentions: "the charity race" or "recent race"
- Don't re-explain established context

IDENTITY AND DEFINITIONAL RELATIONSHIP PRESERVATION:
- Preserve possessive phrases that define relationships: "my X, Y" → "Y, [person]'s X"
- Keep origin/source relationships: "from my X" → preserve the X connection
- Preserve family/professional/institutional relationships expressed through possessives
- Don't reduce identity-rich phrases to simple location/entity references
</strategic_enrichment>

<quality_control>
RETURN "NOTHING_TO_SUMMARISE" if content consists ONLY of:
- Pure generic responses without context ("awesome", "thanks", "okay" with no subject)
- Empty pleasantries with no substance ("how are you", "have a good day")
- Standalone acknowledgments without topic reference ("got it", "will do")
- Truly vague encouragement with no specific subject matter ("great job" with no context)
- Already captured information without new connections
- Technical noise or system messages

STORE IN MEMORY if content contains:
- Specific facts, names, dates, or detailed information
- Personal details, preferences, or decisions
- Concrete plans, commitments, or actions
- Visual content with specific details
- Temporal information that can be resolved
- New connections to existing knowledge
- Encouragement that references specific activities or topics
- Statements expressing personal values or beliefs
- Support that's contextually relevant to ongoing conversations
- Responses that reveal relationship dynamics or personal characteristics

MEANINGFUL ENCOURAGEMENT EXAMPLES (STORE these):
- "Taking time for yourself is so important" → Shows personal values about self-care
- "You're doing an awesome job looking after yourself and your family" → Specific topic reference
- "That charity race sounds great" → Contextually relevant support
- "Your future family is gonna be so lucky" → Values-based encouragement about specific situation

EMPTY ENCOURAGEMENT EXAMPLES (DON'T STORE these):
- "Great job!" (no context)
- "Awesome!" (no subject)
- "Keep it up!" (no specific reference)
</quality_control>

<enrichment_examples>
HIGH VALUE enrichment:
- Original: "She said yes!" 
- Enriched: "Caroline received approval from Bright Futures Agency for her adoption application."
- Why: Resolves unclear pronoun, adds temporal context, identifies the approving entity

MINIMAL enrichment (emotional support):
- Original: "You'll be an awesome mom! Good luck!"
- Enriched: "Melanie encouraged Caroline about her adoption plans, affirming she would be an awesome mother."
- Why: Simple temporal context, preserve emotional tone, no historical dumping

ANTI-BLOAT example (what NOT to do):
- Wrong: "Melanie praised Caroline for her commitment to creating a family for children in need through adoption—supported by the inclusive Adoption Agency whose brochure and signs reading 'new arrival' and 'information and domestic building' Caroline had shared earlier that day—and encouraged her by affirming she would be an awesome mom."
- Right: "Melanie encouraged Caroline about her adoption plans, affirming she would be an awesome mother."

CLEAR REFERENCE (minimal enrichment):
- Original: "Thanks, Caroline! The event was really thought-provoking."
- Enriched: "Melanie thanked Caroline and described the charity race as thought-provoking."
- Why: Clear context doesn't need repetitive anchoring

CONVERSATION FLOW EXAMPLES:
❌ WRONG (context fatigue): "reinforcing their ongoing conversation about mental health following Melanie's participation in the recent charity race for mental health"
✅ RIGHT (minimal reference): "reinforcing their conversation about mental health"

❌ WRONG (compound enrichment): "as she begins the process of turning her dream of giving children a loving home into reality and considers specific adoption agencies"
✅ RIGHT (focused): "as she begins pursuing her adoption plans"

❌ WRONG (over-contextualization): "following her participation in the May 20, 2023 charity race for mental health awareness"
✅ RIGHT (after first mention): "following the recent charity race"

GENERIC IDENTITY PRESERVATION EXAMPLES:
- Original: "my hometown, Boston" → Enriched: "Boston, [person]'s hometown" 
- Original: "my workplace, Google" → Enriched: "Google, [person]'s workplace"
- Original: "my sister, Sarah" → Enriched: "Sarah, [person]'s sister"
- Original: "from my university, MIT" → Enriched: "from MIT, [person]'s university"

POSSESSIVE + APPOSITIVE PATTERNS (Critical for Relations):
- Original: "my colleague at my office, Microsoft" 
- Enriched: "his colleague at Microsoft, David's workplace"
- Why: Preserves both the work relationship AND the employment identity

- Original: "my friend from my university, Stanford"
- Enriched: "her friend from Stanford, Lisa's alma mater"
- Why: Establishes both the friendship and educational institution identity

- Original: "my neighbor in my city, Chicago"
- Enriched: "his neighbor in Chicago, Mark's hometown"
- Why: Maintains both the neighbor relationship and residence identity

❌ WRONG (loses relationships): reduces to just entity names without preserving the defining relationship
✅ RIGHT (preserves identity): maintains the possessive/definitional connection that establishes entity relationships
</enrichment_examples>

OUTPUT FORMAT REQUIREMENTS:
- Provide your response directly in HTML format
- Use appropriate HTML tags for structure and formatting (p, h1-h6, ul, ol, strong, em, etc.)
- Do NOT wrap your response in any special tags like <output>
- If there is nothing worth summarizing, return: NOTHING_TO_SUMMARISE

FORMAT EXAMPLES:
✅ CORRECT: <p>Caroline shared her adoption plans with Melanie, discussing the application process and timeline.</p>
✅ CORRECT: <h3>Italy Trip Planning</h3><p>User explored romantic destinations for their anniversary celebration.</p>
✅ CORRECT: NOTHING_TO_SUMMARISE
❌ WRONG: Plain text without HTML formatting
`,
    },
    {
      role: "user",
      content: `Title: ${title}
Content: ${contentWithImages}
<SAME_SESSION_CONTEXT>
${lastSummary || "No previous episodes in this session"}
</SAME_SESSION_CONTEXT>
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

async function* generateSummaryWithChunks(
  content: string,
  title: string,
  imageSummaries: string[],
) {
  const documentchunk = new DocumentChunker();
  const chunks = await documentchunk.chunkDocument(content, title);

  let lastSummary = "";
  for await (const chunk of chunks.chunks) {
    const response = (await generateSummary(
      chunk.title || title,
      chunk.content,
      lastSummary ? lastSummary : null,
      imageSummaries,
    )) as any;

    for await (const res of response.textStream) {
      lastSummary += res;
      yield res;
    }

    // Use the complete current chunk summary as context for the next chunk
    lastSummary = lastSummary.trim();
  }
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
          const response = generateSummaryWithChunks(
            extraction.content,
            extraction.title,
            imageSummaries,
          ) as any;

          const stream = await metadata.stream("messages", response);

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
