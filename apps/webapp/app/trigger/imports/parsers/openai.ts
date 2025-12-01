import { logger } from "~/services/logger.service";
import type { ParsedConversation, ParsedExchange } from "./claude";

/**
 * OpenAI/ChatGPT export JSON structure
 */
interface ChatGPTExport {
  title: string;
  create_time: number; // Unix timestamp
  update_time: number;
  mapping: Record<string, ChatGPTNode>;
  conversation_id?: string;
}

interface ChatGPTNode {
  id: string;
  message: ChatGPTMessage | null;
  parent: string | null;
  children: string[];
}

interface ChatGPTMessage {
  id: string;
  author: {
    role: "user" | "assistant" | "system";
    name?: string | null;
    metadata?: any;
  };
  create_time: number | null;
  update_time?: number | null;
  content: {
    content_type: string;
    parts: string[];
  };
  status?: string;
  end_turn?: boolean | null;
  weight?: number;
  metadata?: any;
  recipient?: string;
  channel?: string | null;
}

/**
 * Parse OpenAI/ChatGPT conversation export JSON
 * Converts conversations into user-assistant exchanges (each exchange = 1 episode)
 */
export function parseOpenAIExport(
  conversationsJson: any[],
): ParsedConversation[] {
  logger.info("[OpenAI Parser] Starting parse", {
    conversationCount: conversationsJson.length,
  });

  const parsed: ParsedConversation[] = [];

  for (const conv of conversationsJson) {
    try {
      const chatGPTConv = conv as ChatGPTExport;

      // Skip conversations without mapping
      if (!chatGPTConv.mapping || Object.keys(chatGPTConv.mapping).length === 0) {
        logger.warn("[OpenAI Parser] Skipping conversation without mapping", {
          title: chatGPTConv.title,
        });
        continue;
      }

      // Extract linear message flow from tree structure
      const messages = extractMessagesFromMapping(chatGPTConv.mapping);

      if (messages.length === 0) {
        logger.warn("[OpenAI Parser] No messages found in conversation", {
          title: chatGPTConv.title,
        });
        continue;
      }

      // Parse messages into user-assistant exchanges
      const exchanges = extractExchanges(
        messages,
        chatGPTConv.title,
        chatGPTConv.conversation_id || generateConversationId(chatGPTConv)
      );

      if (exchanges.length === 0) {
        logger.warn("[OpenAI Parser] No valid exchanges found in conversation", {
          title: chatGPTConv.title,
        });
        continue;
      }

      parsed.push({
        id: chatGPTConv.conversation_id || generateConversationId(chatGPTConv),
        title: chatGPTConv.title || "Untitled Conversation",
        createdAt: new Date(chatGPTConv.create_time * 1000),
        updatedAt: new Date(chatGPTConv.update_time * 1000),
        exchanges,
      });

      logger.info("[OpenAI Parser] Parsed conversation", {
        title: chatGPTConv.title,
        exchangeCount: exchanges.length,
      });
    } catch (error) {
      logger.error("[OpenAI Parser] Failed to parse conversation", {
        conversation: conv,
        error,
      });
      // Continue with other conversations
    }
  }

  const totalExchanges = parsed.reduce((sum, conv) => sum + conv.exchanges.length, 0);

  logger.info("[OpenAI Parser] Parse completed", {
    totalConversations: conversationsJson.length,
    parsedConversations: parsed.length,
    totalExchanges,
  });

  return parsed;
}

/**
 * Extract linear message flow from ChatGPT's tree-based mapping structure
 * Follows the main conversation path (first child at each branch)
 */
function extractMessagesFromMapping(
  mapping: Record<string, ChatGPTNode>
): ChatGPTMessage[] {
  const messages: ChatGPTMessage[] = [];

  // Find root node (usually "client-created-root" or node with null parent)
  let currentNodeId: string | null = null;

  for (const [nodeId, node] of Object.entries(mapping)) {
    if (node.parent === null || nodeId === "client-created-root") {
      currentNodeId = nodeId;
      break;
    }
  }

  if (!currentNodeId) {
    logger.warn("[OpenAI Parser] No root node found in mapping");
    return messages;
  }

  // Traverse tree following first child path
  const visited = new Set<string>();

  while (currentNodeId) {
    if (visited.has(currentNodeId)) {
      logger.warn("[OpenAI Parser] Circular reference detected", { nodeId: currentNodeId });
      break;
    }

    visited.add(currentNodeId);
    const node: ChatGPTNode = mapping[currentNodeId];

    if (!node) {
      break;
    }

    // Add message if it exists and is not system/empty
    if (
      node.message &&
      node.message.author.role !== "system" &&
      node.message.content.parts.length > 0 &&
      node.message.content.parts[0].trim() !== ""
    ) {
      messages.push(node.message);
    }

    // Follow first child (main conversation path)
    if (node.children && node.children.length > 0) {
      currentNodeId = node.children[0];
    } else {
      currentNodeId = null;
    }
  }

  return messages;
}

/**
 * Extract user-assistant exchanges from linear message list
 */
function extractExchanges(
  messages: ChatGPTMessage[],
  conversationTitle: string,
  sessionId: string
): ParsedExchange[] {
  const exchanges: ParsedExchange[] = [];

  for (let i = 0; i < messages.length; i++) {
    const currentMsg = messages[i];

    // Look for user message
    if (currentMsg.author.role === "user") {
      // Find next assistant message
      const nextMsg = messages[i + 1];

      if (nextMsg && nextMsg.author.role === "assistant") {
        const userText = currentMsg.content.parts.join("\n");
        const assistantText = nextMsg.content.parts.join("\n");

        // Create timestamp from user message
        const timestamp = currentMsg.create_time
          ? new Date(currentMsg.create_time * 1000)
          : new Date();

        exchanges.push({
          id: `${sessionId}-exchange-${exchanges.length}`,
          userMessage: userText,
          assistantMessage: assistantText,
          timestamp,
          conversationTitle,
          sessionId,
        });

        // Skip the assistant message in next iteration
        i++;
      } else {
        // User message without assistant response - skip
        logger.debug("[OpenAI Parser] User message without assistant response", {
          messageId: currentMsg.id,
        });
      }
    }
  }

  return exchanges;
}

/**
 * Generate a unique conversation ID from conversation data
 */
function generateConversationId(conv: ChatGPTExport): string {
  // Use first message ID as stable identifier if available
  const firstNode = Object.values(conv.mapping).find(
    (node) => node.message && node.message.author.role === "user"
  );

  if (firstNode?.message?.id) {
    return `chatgpt-${firstNode.message.id}`;
  }

  // Fallback: use title + create time hash
  return `chatgpt-${conv.title.replace(/\s+/g, "-").toLowerCase()}-${conv.create_time}`;
}

/**
 * Validate OpenAI/ChatGPT export JSON structure
 */
export function validateOpenAIExport(jsonData: any): boolean {
  if (!Array.isArray(jsonData)) {
    return false;
  }

  // Check if at least one item has ChatGPT export structure
  const sample = jsonData[0];
  if (!sample) {
    return false;
  }

  return (
    typeof sample.title === "string" &&
    typeof sample.create_time === "number" &&
    typeof sample.update_time === "number" &&
    typeof sample.mapping === "object" &&
    sample.mapping !== null
  );
}
