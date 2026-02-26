import crypto from "crypto";
import { logger } from "~/services/logger.service";

/**
 * Verify Slack request signature using HMAC-SHA256.
 * https://api.slack.com/authentication/verifying-requests-from-slack
 */
export function verifySlackSignature(
  signingSecret: string,
  timestamp: string,
  body: string,
  signature: string,
): boolean {
  // Reject requests older than 5 minutes to prevent replay attacks
  const fiveMinutesAgo = Math.floor(Date.now() / 1000) - 60 * 5;
  if (parseInt(timestamp, 10) < fiveMinutesAgo) {
    return false;
  }

  const sigBasestring = `v0:${timestamp}:${body}`;
  const hmac = crypto
    .createHmac("sha256", signingSecret)
    .update(sigBasestring, "utf8")
    .digest("hex");
  const computed = `v0=${hmac}`;

  return crypto.timingSafeEqual(
    Buffer.from(computed, "utf8"),
    Buffer.from(signature, "utf8"),
  );
}

/**
 * Send a message to a Slack channel, optionally in a thread.
 */
export async function sendSlackMessage(
  accessToken: string,
  channel: string,
  text: string,
  threadTs?: string,
): Promise<void> {
  const payload: Record<string, string> = { channel, text };
  if (threadTs) {
    payload.thread_ts = threadTs;
  }

  const msgRes = await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const msgData = await msgRes.json();
  if (!msgData.ok) {
    logger.error("Failed to send Slack message", {
      error: msgData.error,
      channel,
    });
    throw new Error(`Slack chat.postMessage failed: ${msgData.error}`);
  }
}

/**
 * Add a reaction to a Slack message.
 * Used as a "typing indicator" — e.g. :eyes: while processing.
 */
export async function addSlackReaction(
  accessToken: string,
  channel: string,
  timestamp: string,
  emoji: string = "eyes",
): Promise<void> {
  try {
    const res = await fetch("https://slack.com/api/reactions.add", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ channel, timestamp, name: emoji }),
    });
    const data = await res.json();
    if (!data.ok && data.error !== "already_reacted") {
      logger.warn("Failed to add Slack reaction", { error: data.error });
    }
  } catch (error) {
    // Non-critical — don't let reaction failures break the flow
    logger.warn("Failed to add Slack reaction", { error: String(error) });
  }
}

/**
 * Remove a reaction from a Slack message.
 */
export async function removeSlackReaction(
  accessToken: string,
  channel: string,
  timestamp: string,
  emoji: string = "eyes",
): Promise<void> {
  try {
    const res = await fetch("https://slack.com/api/reactions.remove", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ channel, timestamp, name: emoji }),
    });
    const data = await res.json();
    if (!data.ok && data.error !== "no_reaction") {
      logger.warn("Failed to remove Slack reaction", { error: data.error });
    }
  } catch (error) {
    logger.warn("Failed to remove Slack reaction", { error: String(error) });
  }
}

/**
 * Send a DM to a Slack user.
 * Opens a conversation first, then posts a message.
 */
export async function sendSlackDM(
  accessToken: string,
  slackUserId: string,
  text: string,
): Promise<void> {
  const openRes = await fetch("https://slack.com/api/conversations.open", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ users: slackUserId }),
  });

  const openData = await openRes.json();
  if (!openData.ok) {
    logger.error("Failed to open Slack DM conversation", {
      error: openData.error,
      slackUserId,
    });
    throw new Error(`Slack conversations.open failed: ${openData.error}`);
  }

  await sendSlackMessage(accessToken, openData.channel.id, text);
}
