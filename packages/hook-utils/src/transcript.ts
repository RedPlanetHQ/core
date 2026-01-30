import { readFileSync, existsSync } from "fs";

export interface ConversationPair {
  user: string;
  assistant: string;
}

/**
 * Extract all user/assistant conversation pairs from transcript JSONL file
 * If a user message has no following assistant message, the assistant field will be empty
 * @param transcriptPath Path to transcript file
 * @param stripSystemReminders Whether to remove <system-reminder> tags from assistant messages
 * @returns Array of conversation pairs
 */
export function extractConversationPairs(
  transcriptPath: string,
  stripSystemReminders: boolean = false
): ConversationPair[] {
  if (!transcriptPath || !existsSync(transcriptPath)) {
    throw new Error(`Transcript path missing or file does not exist: ${transcriptPath}`);
  }

  const content = readFileSync(transcriptPath, "utf-8").trim();
  if (!content) {
    throw new Error(`Transcript file exists but is empty: ${transcriptPath}`);
  }

  const lines = content.split("\n");
  const pairs: ConversationPair[] = [];
  let currentUserMessage: string | null = null;

  for (const line of lines) {
    const parsed = JSON.parse(line);

    if (parsed.type === "user") {
      // If we have a previous user message without an assistant response, save it with empty assistant
      if (currentUserMessage !== null) {
        pairs.push({ user: currentUserMessage, assistant: "" });
      }

      // Extract the user message
      currentUserMessage = extractMessageContent(parsed);
    } else if (parsed.type === "assistant") {
      // Extract the assistant message
      let assistantMessage = extractMessageContent(parsed);

      // Strip system reminders if requested
      if (stripSystemReminders) {
        assistantMessage = assistantMessage.replace(
          /<system-reminder>[\s\S]*?<\/system-reminder>/g,
          ""
        );
        assistantMessage = assistantMessage.replace(/\n{3,}/g, "\n\n").trim();
      }

      if (assistantMessage && currentUserMessage) {
        pairs.push({ user: currentUserMessage, assistant: assistantMessage });
        currentUserMessage = null;
      }
    }
  }

  // Handle trailing user message without assistant response
  if (currentUserMessage !== null) {
    pairs.push({ user: currentUserMessage, assistant: "" });
  }

  return pairs;
}

/**
 * Extract message content from a parsed JSONL line
 * @param parsed Parsed JSON object
 * @returns Extracted text content
 */
function extractMessageContent(parsed: any): string {
  if (!parsed.message?.content) {
    return "";
  }

  const msgContent = parsed.message.content;

  if (typeof msgContent === "string") {
    return msgContent;
  } else if (Array.isArray(msgContent)) {
    return msgContent
      .filter((c: any) => c.type === "text")
      .map((c: any) => c.text)
      .join("\n");
  } else {
    throw new Error(`Unknown message content format. Type: ${typeof msgContent}`);
  }
}

/**
 * Extract last message of specified role from transcript JSONL file
 * @param transcriptPath Path to transcript file
 * @param role 'user' or 'assistant'
 * @param stripSystemReminders Whether to remove <system-reminder> tags (for assistant)
 */
export function extractLastMessage(
  transcriptPath: string,
  role: "user" | "assistant",
  stripSystemReminders: boolean = false
): string {
  if (!transcriptPath || !existsSync(transcriptPath)) {
    throw new Error(`Transcript path missing or file does not exist: ${transcriptPath}`);
  }

  const content = readFileSync(transcriptPath, "utf-8").trim();
  if (!content) {
    throw new Error(`Transcript file exists but is empty: ${transcriptPath}`);
  }

  const lines = content.split("\n");
  let foundMatchingRole = false;

  for (let i = lines.length - 1; i >= 0; i--) {
    const line = JSON.parse(lines[i]);
    if (line.type === role) {
      foundMatchingRole = true;

      if (line.message?.content) {
        let text = "";
        const msgContent = line.message.content;

        if (typeof msgContent === "string") {
          text = msgContent;
        } else if (Array.isArray(msgContent)) {
          text = msgContent
            .filter((c: any) => c.type === "text")
            .map((c: any) => c.text)
            .join("\n");
        } else {
          // Unknown content format - throw error
          throw new Error(
            `Unknown message content format in transcript. Type: ${typeof msgContent}`
          );
        }

        if (stripSystemReminders) {
          text = text.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, "");
          text = text.replace(/\n{3,}/g, "\n\n").trim();
        }

        // Return text even if empty - caller decides if that's an error
        return text;
      }
    }
  }

  // If we searched the whole transcript and didn't find any message of this role
  if (!foundMatchingRole) {
    throw new Error(`No message found for role '${role}' in transcript: ${transcriptPath}`);
  }

  return "";
}
