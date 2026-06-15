/**
 * Build the payload town expects for `memory.added` / `memory.updated`.
 *
 * Pulls together three pieces from CORE state at fire-time:
 *
 *   1. topics       — episode.labelIds → Label.name, with workspace-scoped
 *                     Document count and top-N similar labels by embedding
 *                     cosine.
 *   2. summary      — latest Document.content for the session, or "" if
 *                     compaction hasn't produced one yet (it runs in
 *                     parallel with ingest).
 *   3. aspects      — VoiceAspects newly resolved for this episode, as
 *                     plain fact strings.
 *
 * Heavy reads are bounded: at most N (labels-on-episode) × (1 vector search
 * + ~10 small counts). Episodes usually carry 1-3 labels.
 */

import { Prisma } from "@prisma/client";

import { prisma } from "~/db.server";
import { getVoiceAspectsForEpisode } from "./aspectStore.server";
import { logger } from "./logger.service";
import type { Topic, TopicSibling } from "./town-webhook.server";

const SIMILAR_LIMIT = 10;

/** Resolve a list of label ids into Topic objects (name + workspace count
 *  + top similar labels). Skips any label id that no longer exists in
 *  Prisma — graceful, not throw-on-mismatch. */
export async function buildTopicsForLabels(
  labelIds: string[],
  workspaceId: string,
): Promise<Topic[]> {
  if (labelIds.length === 0) return [];

  // Pull the canonical label rows in one round-trip.
  const labels = await prisma.label.findMany({
    where: { id: { in: labelIds }, workspaceId },
    select: { id: true, name: true },
  });

  const topics: Topic[] = [];
  for (const label of labels) {
    const [count, similar] = await Promise.all([
      countDocumentsForLabel(label.id, workspaceId),
      findSimilarLabels(label.id, workspaceId, SIMILAR_LIMIT),
    ]);
    topics.push({ id: label.id, name: label.name, count, similar });
  }
  return topics;
}

/** # of Document rows in this workspace that reference the given label. */
async function countDocumentsForLabel(
  labelId: string,
  workspaceId: string,
): Promise<number> {
  return prisma.document.count({
    where: { workspaceId, labelIds: { has: labelId } },
  });
}

/** Top N similar labels (excluding self) by cosine similarity on the
 *  label embedding. Single raw SQL query against `label_embeddings` so we
 *  don't have to re-embed or round-trip through the vector provider. */
async function findSimilarLabels(
  labelId: string,
  workspaceId: string,
  limit: number,
): Promise<TopicSibling[]> {
  try {
    const rows = await prisma.$queryRaw<
      Array<{ id: string; score: number }>
    >`
      WITH source AS (
        SELECT vector FROM label_embeddings WHERE id = ${labelId}
      )
      SELECT
        le.id::text,
        (1 - (le.vector <=> (SELECT vector FROM source)))::float AS score
      FROM label_embeddings le, source
      WHERE le."workspaceId" = ${workspaceId}
        AND le.id <> ${labelId}
        AND (SELECT vector FROM source) IS NOT NULL
      ORDER BY le.vector <=> (SELECT vector FROM source)
      LIMIT ${limit}
    `;

    if (rows.length === 0) return [];

    // Hydrate names + per-sibling Document counts in parallel.
    const ids = rows.map((r) => r.id);
    const [siblingLabels, siblingCounts] = await Promise.all([
      prisma.label.findMany({
        where: { id: { in: ids }, workspaceId },
        select: { id: true, name: true },
      }),
      Promise.all(ids.map((id) => countDocumentsForLabel(id, workspaceId))),
    ]);
    const nameById = new Map(siblingLabels.map((l) => [l.id, l.name]));
    const countByIndex = new Map(ids.map((id, i) => [id, siblingCounts[i]]));

    return rows
      .filter((r) => nameById.has(r.id))
      .map((r) => ({
        id: r.id,
        name: nameById.get(r.id)!,
        count: countByIndex.get(r.id) ?? 0,
        score: r.score,
      }));
  } catch (err: any) {
    // pgvector missing, embedding missing, etc. — degrade to empty, not crash.
    logger.warn(
      `[town-webhook] findSimilarLabels failed for ${labelId}: ${err?.message ?? err}`,
    );
    return [];
  }
}

/** The latest compact summary for this session, or "" if compaction
 *  hasn't produced one yet. Compaction runs in parallel with ingest. */
export async function getSummaryForSession(
  sessionId: string,
  workspaceId: string,
): Promise<string> {
  const doc = await prisma.document.findUnique({
    where: { sessionId_workspaceId: { sessionId, workspaceId } },
    select: { content: true },
  });
  return doc?.content ?? "";
}

/** Identity statements just resolved on this episode, in the user's own
 *  words. Excludes anything that's been invalidated (a supersede arrived
 *  in the same batch). */
export async function getIdentityAspectsForEpisode(
  episodeUuid: string,
  userId: string,
): Promise<string[]> {
  const aspects = await getVoiceAspectsForEpisode(episodeUuid, userId);
  return aspects
    .filter((a) => a.invalidAt === null || a.invalidAt === undefined)
    .map((a) => a.fact)
    .filter((fact) => typeof fact === "string" && fact.length > 0);
}

// `Prisma` is imported only to keep this file ready for future raw-SQL
// helpers that need its tagged-template utilities; the current query uses
// $queryRaw directly via the template literal.
void Prisma;
