/**
 * Memory ingest helpers for multi-agent conversations.
 *
 * Two shapes shift here from the single-agent world:
 *
 * 1. **Attribution.** Previously every assistant reply was wrapped as
 *    `<assistant>...</assistant>`. With multiple agents in one thread, the
 *    ingested episode needs to say who spoke — so we swap in
 *    `<agent handle="{handle}">...</agent>`. Recall over multi-agent
 *    conversations then knows Cass's answer came from Cass, not "some
 *    assistant."
 *
 * 2. **Session bucketing.** Previously `sessionId = conversationId`, so a
 *    long-lived conversation accumulated into one giant session and
 *    compaction/recall couldn't slice by day. We now use
 *    `{conversationId}-YYYY-MM-DD` (user timezone) so each day of a
 *    conversation is its own bucket. Recall can still stitch across
 *    buckets by prefix match on conversationId.
 */

export interface EpisodeSpeakerContext {
  /** The prompting message from the user or previous turn. May be empty
   *  for a specialist follow-up where the trigger was another agent's
   *  message rather than a fresh user prompt. */
  userText?: string;
  /** The reply text this turn is ingesting. */
  agentText: string;
  /** Machine handle of the agent that produced `agentText`. Fallback to
   *  "agent" if the handle is missing so we never emit malformed XML. */
  agentHandle?: string | null;
}

/** Build the `episodeBody` string for a single ingest event. */
export function buildEpisodeBody(ctx: EpisodeSpeakerContext): string {
  const handle = (ctx.agentHandle ?? "agent").trim() || "agent";
  const user = ctx.userText?.trim() ?? "";
  const agent = ctx.agentText ?? "";
  const userChunk = user.length > 0 ? `<user>${user}</user>` : "";
  return `${userChunk}<agent handle="${escapeAttr(handle)}">${agent}</agent>`;
}

/**
 * Session bucket key. Same-day turns on the same conversation share a
 * bucket; the next day rolls to a fresh one. Timezone is the user's, so
 * boundaries match their calendar rather than UTC.
 */
export function buildSessionBucketId(
  conversationId: string,
  timezone: string,
  now: Date = new Date(),
): string {
  const day = formatDateInTimezone(now, timezone);
  return `${conversationId}-${day}`;
}

/** YYYY-MM-DD in the given tz. Falls back to UTC on invalid tz. */
function formatDateInTimezone(date: Date, timezone: string): string {
  try {
    // en-CA gives ISO-style YYYY-MM-DD directly, no locale gymnastics.
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(date);
  } catch {
    return date.toISOString().slice(0, 10);
  }
}

/** Minimal HTML-attribute escape for the handle. Handles are already
 *  restricted to slug characters in practice; this is belt-and-suspenders
 *  so a malformed handle never breaks downstream XML parsers. */
function escapeAttr(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
