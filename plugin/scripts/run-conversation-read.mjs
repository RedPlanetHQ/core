var __defProp = Object.defineProperty;
import { appendFileSync, existsSync, readFileSync } from "fs";

var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

function extractMessageContent(parsed) {
  if (!parsed.message?.content) {
    return "";
  }
  const msgContent = parsed.message.content;
  if (typeof msgContent === "string") {
    return msgContent;
  } else if (Array.isArray(msgContent)) {
    return msgContent
      .filter((c) => c.type === "text")
      .map((c) => c.text)
      .join("\n");
  } else {
    throw new Error(`Unknown message content format. Type: ${typeof msgContent}`);
  }
}
__name(extractMessageContent, "extractMessageContent");
function extractLastAssistantWithPrecedingUsers(_transcriptPath, stripSystemReminders = false) {
  if (!transcriptPath || !existsSync(transcriptPath)) {
    throw new Error(`Transcript path missing or file does not exist: ${transcriptPath}`);
  }

  const content = readFileSync(transcriptPath, "utf-8").trim();
  if (!content) {
    throw new Error(`Transcript file exists but is empty: ${transcriptPath}`);
  }
  const lines = content.split("\n");
  const parsedLines = lines.map((line) => JSON.parse(line));
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
  let assistantMessage = extractMessageContent(parsedLines[lastAssistantIndex]);
  if (stripSystemReminders) {
    assistantMessage = assistantMessage.replace(
      /<system-reminder>[\s\S]*?<\/system-reminder>/g,
      ""
    );
    assistantMessage = assistantMessage.replace(/\n{3,}/g, "\n\n").trim();
  }
  const userMessages = [];
  let gotAtleastOne = false;

  for (let i = lastAssistantIndex - 1; i >= 0; i--) {
    const parsed = parsedLines[i];

    if (parsed.type === "assistant" && gotAtleastOne && extractMessageContent(parsed)) {
      break;
    } else if (parsed.type === "user" && extractMessageContent(parsed)) {
      userMessages.unshift(extractMessageContent(parsed));
      gotAtleastOne = true;
    }
  }
  return {
    assistant: assistantMessage,
    users: userMessages,
  };
}
__name(extractLastAssistantWithPrecedingUsers, "extractLastAssistantWithPrecedingUsers");

console.log(extractLastAssistantWithPrecedingUsers());
