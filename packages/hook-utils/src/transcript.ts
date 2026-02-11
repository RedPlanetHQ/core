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
  if (parsed.type === "assistant" && !parsed.message?.id?.includes("msg_")) {
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

const DEFAULTS = ["[Request interrupted by user for tool use]", "[Request interrupted by user]"];

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
    let assistantMessage = extractMessageContent(parsedLines[i]);

    if (parsedLines[i].type === "assistant" && assistantMessage) {
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
    } else if (parsed.type === "user" && parsed.message && !DEFAULTS.includes(content) && content) {
      // Collect user message (we'll reverse later to maintain chronological order)

      let strippedcontent = content.replace(
        /<local-command-caveat>[\s\S]*?<\/local-command-caveat>/g,
        ""
      );
      strippedcontent = content.replace(
        /<local-command-stdout>[\s\S]*?<\/local-command-stdout>/g,
        ""
      );

      userMessages.unshift(strippedcontent);
      gotAtleastOne = true;
    }
  }

  return {
    assistant: assistantMessage,
    users: userMessages,
  };
}
