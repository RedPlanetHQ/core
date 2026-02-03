import { readFileSync, existsSync } from "fs";

export interface ConversationPair {
  user: string;
  assistant: string;
}

/**
 * Extract message content from a parsed JSONL line
 * @param parsed Parsed JSON object
 * @returns Extracted text content
 */
function extractMessageContent(parsed: any): string {
  if (!parsed.message?.id?.includes("msg_")) {
    return "";
  }

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

const DEFAULTS = ["[Request interrupted by user for tool use]"];

/**
 * Extract the last assistant message and all user messages that came before it
 * (until hitting another assistant message or the start of transcript)
 * @param transcriptPath Path to transcript file
 * @param stripSystemReminders Whether to remove <system-reminder> tags from assistant messages
 * @returns Object with assistant message and array of user messages (in chronological order)
 */
export function extractLastAssistantWithPrecedingUsers(
  transcriptPath: string,
  stripSystemReminders: boolean = false
): { assistant: string; users: string[] } {
  if (!transcriptPath || !existsSync(transcriptPath)) {
    throw new Error(`Transcript path missing or file does not exist: ${transcriptPath}`);
  }

  const content = readFileSync(transcriptPath, "utf-8").trim();
  if (!content) {
    throw new Error(`Transcript file exists but is empty: ${transcriptPath}`);
  }

  const lines = content.split("\n");
  const parsedLines = lines.map((line) => JSON.parse(line));

  // Find the last assistant message
  let lastAssistantIndex = -1;
  for (let i = parsedLines.length - 1; i >= 0; i--) {
    if (parsedLines[i].type === "assistant") {
      lastAssistantIndex = i;
      break;
    }
  }

  if (lastAssistantIndex === -1) {
    throw new Error("No assistant message found in transcript");
  }

  // Extract the assistant message
  let assistantMessage = extractMessageContent(parsedLines[lastAssistantIndex]);
  if (stripSystemReminders) {
    assistantMessage = assistantMessage.replace(
      /<system-reminder>[\s\S]*?<\/system-reminder>/g,
      ""
    );
    assistantMessage = assistantMessage.replace(/\n{3,}/g, "\n\n").trim();
  }

  // Go backwards from the last assistant message to collect all preceding user messages
  const userMessages: string[] = [];
  let gotAtleastOne = false;
  for (let i = lastAssistantIndex - 1; i >= 0; i--) {
    const parsed = parsedLines[i];
    const content = extractMessageContent(parsed);

    if (parsed.type === "assistant" && parsed.message && gotAtleastOne && content) {
      // Stop when we hit another assistant message
      break;
    } else if (parsed.type === "user" && !DEFAULTS.includes(content)) {
      // Collect user message (we'll reverse later to maintain chronological order)
      userMessages.unshift(extractMessageContent(parsed));
      gotAtleastOne = true;
    }
  }

  return {
    assistant: assistantMessage,
    users: userMessages,
  };
}
