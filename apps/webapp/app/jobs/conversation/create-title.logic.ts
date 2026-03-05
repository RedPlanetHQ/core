import { conversationTitlePrompt } from "~/trigger/conversation/prompt";
import { prisma } from "~/db.server";
import { logger } from "~/services/logger.service";
import { generateText, type LanguageModel } from "ai";
import { getModel } from "~/lib/model.server";
import { env } from "~/env.server";

export interface CreateConversationTitlePayload {
  conversationId: string;
  message: string;
}

export interface CreateConversationTitleResult {
  success: boolean;
  title?: string;
  error?: string;
}

/**
 * Core business logic for creating conversation titles
 * This is shared between Trigger.dev and BullMQ implementations
 */
export async function processConversationTitleCreation(
  payload: CreateConversationTitlePayload,
): Promise<CreateConversationTitleResult> {
  try {
    // Default upstream behavior expects strict compliance with the prompt's
    // `<output>{ "title": "..." }</output>` format.
    //
    // Some OpenAI-compatible proxies / self-hosted models may not consistently
    // follow that format. Enable tolerant parsing only when explicitly opted in.
    const tolerantOverride = (process.env.LLM_TOLERANT_OUTPUT || "")
      .trim()
      .toLowerCase();
    // Proxy/self-hosted modes only (preserves upstream defaults):
    // - OPENAI_API_MODE=chat_completions + OPENAI_BASE_URL indicates an OpenAI-compatible proxy
    // - CHAT_PROVIDER=ollama indicates a self-hosted chat model
    const tolerantOutput =
      tolerantOverride
        ? tolerantOverride === "true" || tolerantOverride === "1" || tolerantOverride === "yes"
        : ((env.OPENAI_API_MODE === "chat_completions" || env.OPENAI_API_MODE === "chat") &&
            !!env.OPENAI_BASE_URL) ||
          env.CHAT_PROVIDER === "ollama";
    const { text } = await generateText({
      model: getModel() as LanguageModel,
      messages: [
        {
          role: "user",
          content: conversationTitlePrompt.replace(
            "{{message}}",
            payload.message,
          ),
        },
      ],
    });

    const extractTitle = (raw: string): string | undefined => {
      const stripHtml = (value: string) =>
        value.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
      const outputMatch = raw.match(/<output>(.*?)<\/output>/s);
      if (outputMatch) {
        const jsonStr = outputMatch[1].trim();
        try {
          const parsed = JSON.parse(jsonStr) as { title?: unknown };
          if (typeof parsed?.title === "string" && parsed.title.trim()) {
            const cleaned = stripHtml(parsed.title);
            return cleaned.length > 80 ? cleaned.slice(0, 80).trim() : cleaned;
          }
        } catch {
          // Ignore malformed JSON and fall through to tolerant parsing below (if enabled).
        }
        if (!tolerantOutput) return undefined;

        const tolerantTitleMatch =
          jsonStr.match(/"title"\s*:\s*"([^"]+)"/) ??
          jsonStr.match(/title\s*:\s*"([^"]+)"/);
        const candidate = tolerantTitleMatch?.[1] || jsonStr;
        const normalized = stripHtml(candidate);
        if (!normalized) return undefined;
        return normalized.length > 80 ? normalized.slice(0, 80).trim() : normalized;
      }

      if (!tolerantOutput) {
        return undefined;
      }

      const candidate = raw.trim();
      const jsonCandidate = candidate
        .replace(/^```(?:json)?/i, "")
        .replace(/```$/i, "")
        .trim();

      if (jsonCandidate.startsWith("{")) {
        try {
          const parsed = JSON.parse(jsonCandidate) as { title?: unknown };
          if (typeof parsed?.title === "string" && parsed.title.trim()) {
            const cleaned = stripHtml(parsed.title);
            return cleaned.length > 80 ? cleaned.slice(0, 80).trim() : cleaned;
          }
        } catch {
          // Fall through to plain-text parsing.
        }
      }

      const normalized = stripHtml(candidate);
      if (!normalized) return undefined;
      return normalized.length > 80 ? normalized.slice(0, 80).trim() : normalized;
    };

    const title = extractTitle(text);

    logger.info(
      `Conversation title data: ${JSON.stringify({ hasTitle: !!title, preview: title?.slice(0, 64) })}`,
    );

    if (!title) {
      logger.error("No output found in create conversation title response");
      throw new Error("Invalid response format from AI");
    }

    if (title) {
      await prisma.conversation.update({
        where: {
          id: payload.conversationId,
        },
        data: {
          title,
        },
      });

      return {
        success: true,
        title,
      };
    }

    return {
      success: false,
      error: "No title generated",
    };
  } catch (error: any) {
    logger.error(
      `Error creating conversation title for ${payload.conversationId}:`,
      error,
    );
    return {
      success: false,
      error: error.message,
    };
  }
}
