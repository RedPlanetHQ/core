/**
 * @mention routing primitive.
 *
 * Both the user (via a Tiptap mention extension) and agents themselves
 * (via their model output) emit mentions as HTML tags:
 *
 *     <mention colleague="cass" />
 *     <mention colleague="cass"></mention>
 *
 * When one of these lands in a ConversationHistory row, `dispatchMentions`
 * parses it, resolves each slug against the workspace's Agents table, and
 * spawns a background turn for each mentioned agent — cancelling any
 * previous in-flight turn for the same (conversation, agent) pair.
 *
 * We use structured tags rather than free-text `@handle` parsing on
 * purpose: LLM output is too noisy for a reliable regex, and Tiptap
 * already produces well-formed HTML on the user side. Deterministic
 * routing beats robust parsing.
 */

import { prisma } from "~/db.server";

/** Extracts colleague slugs from a message's parts array or raw HTML.
 *  Accepts three shapes so both agent-emitted markup and the stock
 *  Tiptap Mention extension round-trip:
 *    1. `<mention colleague="cass" />` — the shape agents emit per the
 *       base-prompt guidance.
 *    2. `<span data-colleague="cass" ...>` — custom Tiptap Mention render
 *       when we override renderHTML to a mention-colleague attribute.
 *    3. `<span data-id="cass" ...>` — the stock Tiptap Mention shape when
 *       we haven't customized renderHTML. `data-type="mention"` or
 *       class containing "mention" gates this one so we don't grab
 *       unrelated data-id attributes. */
export function parseMentions(input: unknown): string[] {
  const html = extractHtml(input);
  if (!html) return [];

  const seen = new Set<string>();
  const collect = (pattern: RegExp) => {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(html)) !== null) {
      const slug = match[1].trim().toLowerCase();
      if (slug.length === 0) continue;
      seen.add(slug);
    }
  };

  // 1. Custom mention tag with an explicit colleague attribute.
  collect(/<mention\b[^>]*\bcolleague\s*=\s*["']([^"']+)["'][^>]*\/?>/gi);
  // 2. Span (or other element) that carries data-colleague.
  collect(/<[a-z][^>]*\bdata-colleague\s*=\s*["']([^"']+)["'][^>]*>/gi);
  // 3. Stock Tiptap Mention span. Require either data-type="mention" or
  //    a class name containing "mention" so a bare data-id="…" on some
  //    unrelated element doesn't fire the router.
  collect(
    /<[a-z][^>]*\b(?:data-type\s*=\s*["']mention["']|class\s*=\s*["'][^"']*\bmention\b[^"']*["'])[^>]*\bdata-id\s*=\s*["']([^"']+)["'][^>]*>/gi,
  );
  collect(
    /<[a-z][^>]*\bdata-id\s*=\s*["']([^"']+)["'][^>]*\b(?:data-type\s*=\s*["']mention["']|class\s*=\s*["'][^"']*\bmention\b[^"']*["'])[^>]*>/gi,
  );
  return [...seen];
}

/**
 * Resolve a slug (e.g. "cass") to an active Agents row in the workspace.
 * Matches either the `handle` or the `displayName` (case-insensitive) so
 * "@cass" and "@Cass" both work regardless of how the agent was created.
 * Returns null for unknown / inactive slugs — the dispatcher logs and
 * skips these silently.
 */
export async function resolveColleague(
  workspaceId: string,
  slug: string,
): Promise<{ id: string; handle: string; displayName: string } | null> {
  const row = await prisma.agents.findFirst({
    where: {
      workspaceId,
      status: "Active",
      OR: [
        { handle: { equals: slug, mode: "insensitive" } },
        { displayName: { equals: slug, mode: "insensitive" } },
      ],
    },
    select: { id: true, handle: true, displayName: true },
  });
  return row;
}

/**
 * Best-effort extraction of HTML/text from a ConversationHistory row's
 * `parts` field. Handles the two common shapes we persist:
 *   - `[{ type: "text", text: "…<mention …/>…" }, …]`
 *   - a raw HTML string (older code paths)
 * Anything else returns "" — the parser then finds no mentions, which is
 * the right fail-open behavior.
 */
function extractHtml(input: unknown): string {
  if (typeof input === "string") return input;
  if (!Array.isArray(input)) return "";
  const chunks: string[] = [];
  for (const part of input) {
    if (!part || typeof part !== "object") continue;
    const p = part as { type?: unknown; text?: unknown };
    if (p.type === "text" && typeof p.text === "string") {
      chunks.push(p.text);
    }
  }
  return chunks.join("\n");
}
