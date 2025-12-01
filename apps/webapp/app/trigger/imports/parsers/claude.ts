import { logger } from "~/services/logger.service";

/**
 * Parsed conversation in unified format
 */
export interface ParsedConversation {
  id: string;
  title: string;
  createdAt: Date;
  updatedAt: Date;
  exchanges: ParsedExchange[];
}

/**
 * A single user-assistant exchange (becomes one episode)
 */
export interface ParsedExchange {
  id: string; // Unique ID for this exchange
  userMessage: string;
  assistantMessage: string;
  timestamp: Date; // Timestamp of user message
  conversationTitle: string;
  sessionId: string;
}

/**
 * Claude export JSON structure
 */
interface ClaudeExport {
  uuid: string;
  name: string;
  summary?: string;
  created_at: string;
  updated_at: string;
  chat_messages: ClaudeMessage[];
}

interface ClaudeMessage {
  uuid: string;
  text: string;
  sender: "human" | "assistant";
  created_at: string;
  content?: Array<{
    type: string;
    text?: string;
    [key: string]: any;
  }>;
}

/**
 * Parse Claude conversation export JSON
 * Converts conversations into user-assistant exchanges (each exchange = 1 episode)
 */
export function parseClaudeExport(
  conversationsJson: any[],
): ParsedConversation[] {
  logger.info("[Claude Parser] Starting parse", {
    conversationCount: conversationsJson.length,
  });

  const parsed: ParsedConversation[] = [];

  for (const conv of conversationsJson) {
    try {
      const claudeConv = conv as ClaudeExport;

      // Skip empty conversations
      if (!claudeConv.chat_messages || claudeConv.chat_messages.length === 0) {
        logger.warn("[Claude Parser] Skipping empty conversation", {
          id: claudeConv.uuid,
          title: claudeConv.name,
        });
        continue;
      }

      // Parse messages into user-assistant exchanges
      const exchanges: ParsedExchange[] = [];
      const messages = claudeConv.chat_messages;

      for (let i = 0; i < messages.length; i++) {
        const currentMsg = messages[i];

        // Look for user message
        if (currentMsg.sender === "human") {
          // Find next assistant message
          const nextMsg = messages[i + 1];

          if (nextMsg && nextMsg.sender === "assistant") {
            exchanges.push({
              id: `${claudeConv.uuid}-exchange-${exchanges.length}`,
              userMessage: currentMsg.text || "",
              assistantMessage: nextMsg.text || "",
              timestamp: new Date(currentMsg.created_at),
              conversationTitle: claudeConv.name || "Untitled Conversation",
              sessionId: claudeConv.uuid,
            });
            // Skip the assistant message in next iteration
            i++;
          } else {
            // User message without assistant response - skip or log
            logger.warn("[Claude Parser] User message without assistant response", {
              conversationId: claudeConv.uuid,
              messageId: currentMsg.uuid,
            });
          }
        }
      }

      if (exchanges.length === 0) {
        logger.warn("[Claude Parser] No valid exchanges found in conversation", {
          id: claudeConv.uuid,
          title: claudeConv.name,
        });
        continue;
      }

      parsed.push({
        id: claudeConv.uuid,
        title: claudeConv.name || "Untitled Conversation",
        createdAt: new Date(claudeConv.created_at),
        updatedAt: new Date(claudeConv.updated_at),
        exchanges,
      });

      logger.info("[Claude Parser] Parsed conversation", {
        id: claudeConv.uuid,
        title: claudeConv.name,
        exchangeCount: exchanges.length,
      });
    } catch (error) {
      logger.error("[Claude Parser] Failed to parse conversation", {
        conversation: conv,
        error,
      });
      // Continue with other conversations
    }
  }

  const totalExchanges = parsed.reduce((sum, conv) => sum + conv.exchanges.length, 0);

  logger.info("[Claude Parser] Parse completed", {
    totalConversations: conversationsJson.length,
    parsedConversations: parsed.length,
    totalExchanges,
  });

  return parsed;
}

/**
 * Validate Claude export JSON structure
 */
export function validateClaudeExport(jsonData: any): boolean {
  if (!Array.isArray(jsonData)) {
    return false;
  }

  // Check if at least one item has Claude export structure
  const sample = jsonData[0];
  if (!sample) {
    return false;
  }

  return (
    typeof sample.uuid === "string" &&
    typeof sample.name === "string" &&
    typeof sample.created_at === "string" &&
    Array.isArray(sample.chat_messages)
  );
}

/**
 * Format a single exchange as episode content
 */
export function formatExchangeAsEpisode(exchange: ParsedExchange): string {
  return `# ${exchange.conversationTitle}

**User**: ${exchange.userMessage}

**Assistant**: ${exchange.assistantMessage}`;
}
