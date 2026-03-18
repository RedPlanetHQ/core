import { prisma } from "~/db.server";
import { sendSlackDM, sendSlackMessage } from "./client";
import { logger } from "~/services/logger.service";
import type { ReplyMetadata } from "../types";

// ---------------------------------------------------------------------------
// Markdown → Slack Block Kit conversion
// ---------------------------------------------------------------------------

function convertInlineMd(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, "*$1*") // **bold** → *bold*
    .replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, "_$1_") // *italic* → _italic_
    .replace(/~~(.+?)~~/g, "~$1~") // ~~strike~~ → ~strike~
    .replace(/\[(.+?)\]\((.+?)\)/g, "<$2|$1>"); // [text](url) → <url|text>
}

function stripInlineMd(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/\*(.+?)\*/g, "$1")
    .replace(/_(.+?)_/g, "$1")
    .replace(/~~(.+?)~~/g, "$1")
    .replace(/\[(.+?)\]\(.+?\)/g, "$1")
    .replace(/`(.+?)`/g, "$1");
}

function chunkText(text: string, max: number): string[] {
  if (text.length <= max) return [text];
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > max) {
    const idx = remaining.lastIndexOf("\n\n", max);
    const at = idx > 0 ? idx : max;
    chunks.push(remaining.slice(0, at).trim());
    remaining = remaining.slice(at).trim();
  }
  if (remaining) chunks.push(remaining);
  return chunks;
}

function markdownToSlackBlocks(markdown: string): unknown[] {
  const blocks: unknown[] = [];
  const lines = markdown.split("\n");
  let sectionLines: string[] = [];

  function flushSection() {
    if (sectionLines.length === 0) return;
    const text = convertInlineMd(sectionLines.join("\n").trimEnd());
    sectionLines = [];
    if (!text.trim()) return;
    for (const chunk of chunkText(text, 3000)) {
      blocks.push({ type: "section", text: { type: "mrkdwn", text: chunk } });
    }
  }

  for (const line of lines) {
    // H1/H2 → header block
    const h2 = line.match(/^#{1,2}\s+(.+)/);
    if (h2) {
      flushSection();
      blocks.push({
        type: "header",
        text: {
          type: "plain_text",
          text: stripInlineMd(h2[1]).slice(0, 150),
          emoji: true,
        },
      });
      continue;
    }

    // H3–H6 → bold section
    const h3 = line.match(/^#{3,6}\s+(.+)/);
    if (h3) {
      flushSection();
      blocks.push({
        type: "section",
        text: { type: "mrkdwn", text: `*${convertInlineMd(h3[1])}*` },
      });
      continue;
    }

    // Horizontal rule → divider
    if (line.match(/^[-*_]{3,}\s*$/)) {
      flushSection();
      blocks.push({ type: "divider" });
      continue;
    }

    // Table separator row — skip
    if (line.match(/^\|[\s:|-]+\|/)) {
      continue;
    }

    // Table data row — flatten to text
    if (line.startsWith("|")) {
      const cells = line
        .split("|")
        .filter((c) => c.trim())
        .map((c) => convertInlineMd(c.trim()));
      sectionLines.push(cells.join("   |   "));
      continue;
    }

    sectionLines.push(line);
  }

  flushSection();

  // Slack enforces max 50 blocks
  return blocks.slice(0, 50);
}

function markdownToPlainText(markdown: string): string {
  return markdown
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/\*(.+?)\*/g, "$1")
    .replace(/_(.+?)_/g, "$1")
    .replace(/~~(.+?)~~/g, "$1")
    .replace(/\[(.+?)\]\(.+?\)/g, "$1")
    .replace(/`(.+?)`/g, "$1")
    .replace(/^\|[\s:|-]+\|.*$/gm, "")
    .replace(/^[-*_]{3,}\s*$/gm, "")
    .trim();
}

/**
 * Look up the Slack bot token for a given Slack user ID.
 */
export async function getSlackBotToken(
  slackUserId: string,
  workspaceId?: string,
): Promise<string | null> {
  const account = await prisma.integrationAccount.findFirst({
    where: {
      accountId: slackUserId,
      integrationDefinition: { slug: "slack" },
      isActive: true,
      deleted: null,
      ...(workspaceId ? { workspaceId } : {}),
    },
    select: {
      integrationConfiguration: true,
    },
  });

  if (!account) {
    logger.error("No Slack integration account found for user", {
      slackUserId,
    });
    return null;
  }

  const config = account.integrationConfiguration as Record<string, string>;
  return config?.bot_token ?? null;
}

/**
 * Send a Slack reply.
 * - If metadata has slackChannel/threadTs (from @mention), replies in the channel thread.
 * - Otherwise, sends a DM.
 */
export async function sendReply(
  to: string,
  text: string,
  metadata?: ReplyMetadata,
): Promise<void> {
  const botToken = await getSlackBotToken(
    to,
    metadata?.workspaceId as string | undefined,
  );

  if (!botToken) {
    logger.error("No bot_token in Slack integration config", {
      slackUserId: to,
    });
    return;
  }

  const blocks = markdownToSlackBlocks(text);
  const plainText = markdownToPlainText(text);

  // @mention — reply in the channel thread
  const slackChannel = metadata?.slackChannel as string | undefined;
  if (slackChannel) {
    const threadTs = metadata?.threadTs as string | undefined;
    await sendSlackMessage(botToken, slackChannel, plainText, threadTs, blocks);
    return;
  }

  // DM
  await sendSlackDM(botToken, to, plainText, blocks);
}
