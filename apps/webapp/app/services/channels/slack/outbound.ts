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
 * Look up the Slack bot token from the Channel table.
 * Prefers a specific Channel by channelId; falls back to the workspace's
 * default (or first active) Slack channel.
 */
export async function getSlackBotToken(
  workspaceId: string,
  channelId?: string,
): Promise<{ botToken: string } | null> {
  const channel = channelId
    ? await prisma.channel.findFirst({
        where: { id: channelId, workspaceId, type: "slack", isActive: true },
      })
    : await prisma.channel.findFirst({
        where: { workspaceId, type: "slack", isActive: true },
        orderBy: { isDefault: "desc" },
      });

  if (!channel) {
    logger.error("No active Slack channel found", { workspaceId, channelId });
    return null;
  }

  const config = channel.config as Record<string, string>;
  if (!config.bot_token) {
    logger.error("No bot_token in Slack channel config", { channelId: channel.id });
    return null;
  }

  return { botToken: config.bot_token };
}

/**
 * Send a Slack reply.
 * - If metadata has slackChannel/threadTs (from @mention), replies in the channel thread.
 * - If metadata has channelId, uses that Channel record's channel_id for delivery.
 * - Otherwise, sends a DM to `to` (Slack user ID).
 */
export async function sendReply(
  to: string,
  text: string,
  metadata?: ReplyMetadata,
): Promise<void> {
  const workspaceId = metadata?.workspaceId as string | undefined;
  const channelId = metadata?.channelId as string | undefined;

  if (!workspaceId) {
    logger.error("No workspaceId in Slack reply metadata", { to });
    return;
  }

  const result = await getSlackBotToken(workspaceId, channelId);
  if (!result) return;

  const { botToken } = result;
  const blocks = markdownToSlackBlocks(text);
  const plainText = markdownToPlainText(text);

  // @mention — reply in the channel thread
  const slackChannel = metadata?.slackChannel as string | undefined;
  if (slackChannel) {
    const threadTs = metadata?.threadTs as string | undefined;
    await sendSlackMessage(botToken, slackChannel, plainText, threadTs, blocks);
    return;
  }

  // DM — `to` is the Slack user ID (set from inbound replyTo)
  await sendSlackDM(botToken, to, plainText, blocks);
}
