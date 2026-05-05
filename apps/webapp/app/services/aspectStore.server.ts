/**
 * Voice Aspects Store Service
 *
 * CRUD + query operations for voice aspects (Directive, Preference, Habit, Belief, Goal).
 * Voice aspects store complete non-decomposed user statements — the user's "voice".
 * Embeddings stored in vector provider under VECTOR_NAMESPACES.ASPECT.
 * Metadata stored in Postgres voice_aspects table.
 */

import { type VoiceAspect, type VoiceAspectNode } from "@core/types";
import { ProviderFactory, VECTOR_NAMESPACES } from "@core/providers";
import { prisma } from "~/db.server";
import { getEmbedding } from "~/lib/model.server";
import { logger } from "./logger.service";

const vectorProvider = () => ProviderFactory.getVectorProvider();

/** Map a Prisma VoiceAspect record to VoiceAspectNode */
function toNode(r: {
  id: string;
  fact: string;
  aspect: string;
  userId: string;
  workspaceId: string | null;
  episodeUuids: string[];
  createdAt: Date;
  validAt: Date;
  invalidAt: Date | null;
  invalidatedBy: string | null;
}): VoiceAspectNode {
  return {
    uuid: r.id,
    fact: r.fact,
    aspect: r.aspect as VoiceAspect,
    userId: r.userId,
    workspaceId: r.workspaceId ?? undefined,
    episodeUuids: r.episodeUuids,
    createdAt: r.createdAt,
    validAt: r.validAt,
    invalidAt: r.invalidAt,
    invalidatedBy: r.invalidatedBy ?? undefined,
  };
}

/**
 * Save voice aspects from extraction and store their embeddings
 */
export async function saveVoiceAspects(
  aspects: Array<{
    fact: string;
    aspect: VoiceAspect;
    episodeUuid: string;
    userId: string;
    workspaceId: string;
  }>,
): Promise<VoiceAspectNode[]> {
  if (aspects.length === 0) return [];

  const saved: VoiceAspectNode[] = [];

  for (const a of aspects) {
    const record = await prisma.voiceAspect.create({
      data: {
        fact: a.fact,
        aspect: a.aspect,
        episodeUuids: [a.episodeUuid],
        userId: a.userId,
        workspaceId: a.workspaceId,
        validAt: new Date(),
      },
    });
    saved.push(toNode(record));
  }

  // Generate and store embeddings in vector provider
  const embeddings = await Promise.all(saved.map((s) => getEmbedding(s.fact)));

  const items = saved.map((s, i) => ({
    id: s.uuid,
    vector: embeddings[i],
    content: s.fact,
    metadata: {
      userId: s.userId,
      workspaceId: s.workspaceId,
      aspect: s.aspect,
      type: "voice_aspect",
    },
  }));

  await vectorProvider().batchUpsert(items, VECTOR_NAMESPACES.ASPECT);

  return saved;
}

/**
 * Find similar voice aspects by vector similarity (for dedup in aspect-resolution)
 */
export async function findSimilarVoiceAspects(params: {
  fact: string;
  userId: string;
  workspaceId: string;
  aspect?: VoiceAspect;
  limit?: number;
  threshold?: number;
}): Promise<Array<VoiceAspectNode & { score: number }>> {
  const embedding = await getEmbedding(params.fact);

  const results = await vectorProvider().search({
    vector: embedding,
    namespace: VECTOR_NAMESPACES.ASPECT,
    limit: params.limit || 10,
    threshold: params.threshold || 0.8,
    filter: {
      userId: params.userId,
      workspaceId: params.workspaceId,
      ...(params.aspect ? { aspect: params.aspect } : {}),
    },
  });

  if (results.length === 0) return [];

  const records = await prisma.voiceAspect.findMany({
    where: {
      id: { in: results.map((r) => r.id) },
      invalidAt: null,
    },
  });

  const recordMap = new Map(records.map((r) => [r.id, r]));

  return results
    .filter((r) => recordMap.has(r.id))
    .map((r) => ({
      ...toNode(recordMap.get(r.id)!),
      score: r.score,
    }));
}

/**
 * Invalidate a voice aspect (mark as superseded by a newer version)
 */
export async function invalidateVoiceAspect(
  aspectId: string,
  invalidatedByEpisodeUuid: string,
): Promise<void> {
  await prisma.voiceAspect.update({
    where: { id: aspectId },
    data: {
      invalidAt: new Date(),
      invalidatedBy: invalidatedByEpisodeUuid,
    },
  });
}

/**
 * Append an episode UUID to an existing voice aspect (for duplicates)
 */
export async function appendEpisodeToVoiceAspect(
  aspectId: string,
  episodeUuid: string,
): Promise<void> {
  await prisma.voiceAspect.update({
    where: { id: aspectId },
    data: {
      episodeUuids: { push: episodeUuid },
    },
  });
}

/**
 * Get active voice aspects for a user, optionally filtered by aspect type
 */
export async function getActiveVoiceAspects(params: {
  userId: string;
  workspaceId?: string;
  aspect?: VoiceAspect;
  limit?: number;
}): Promise<VoiceAspectNode[]> {
  const records = await prisma.voiceAspect.findMany({
    where: {
      userId: params.userId,
      ...(params.workspaceId ? { workspaceId: params.workspaceId } : {}),
      ...(params.aspect ? { aspect: params.aspect } : {}),
      invalidAt: null,
    },
    orderBy: { createdAt: "desc" },
    take: params.limit || 100,
  });

  return records.map(toNode);
}

/**
 * Get voice aspects for a specific episode
 */
export async function getVoiceAspectsForEpisode(
  episodeUuid: string,
  userId: string,
  aspects?: VoiceAspect[],
): Promise<VoiceAspectNode[]> {
  const records = await prisma.voiceAspect.findMany({
    where: {
      episodeUuids: { has: episodeUuid },
      userId,
      ...(aspects ? { aspect: { in: aspects } } : {}),
    },
  });

  return records.map(toNode);
}

/**
 * Get voice aspects that were invalidated BY a given episode (across the
 * specified aspect set). Used by the persona orchestrator to fold
 * tombstones into the per-episode pass.
 */
export async function getInvalidatedVoiceAspectsForEpisode(
  episodeUuid: string,
  userId: string,
  aspects: VoiceAspect[],
): Promise<VoiceAspectNode[]> {
  const records = await prisma.voiceAspect.findMany({
    where: {
      invalidatedBy: episodeUuid,
      userId,
      aspect: { in: aspects },
    },
  });
  return records.map(toNode);
}

/**
 * Search voice aspects by vector similarity (for Search V2)
 */
export async function searchVoiceAspects(params: {
  queryVector: number[];
  userId: string;
  workspaceId: string;
  aspect?: VoiceAspect;
  limit?: number;
  threshold?: number;
}): Promise<Array<VoiceAspectNode & { score: number }>> {
  const results = await vectorProvider().search({
    vector: params.queryVector,
    namespace: VECTOR_NAMESPACES.ASPECT,
    limit: params.limit || 20,
    threshold: params.threshold || 0.5,
    filter: {
      userId: params.userId,
      workspaceId: params.workspaceId,
      ...(params.aspect ? { aspect: params.aspect } : {}),
    },
  });

  if (results.length === 0) return [];

  const records = await prisma.voiceAspect.findMany({
    where: {
      id: { in: results.map((r) => r.id) },
      invalidAt: null,
    },
  });

  const recordMap = new Map(records.map((r) => [r.id, r]));

  return results
    .filter((r) => recordMap.has(r.id))
    .map((r) => ({
      ...toNode(recordMap.get(r.id)!),
      score: r.score,
    }));
}

/**
 * Get voice aspects in a time range grouped by aspect type (for temporal_facets)
 * Queries Postgres directly by validAt — no vector search needed
 */
export async function getVoiceAspectsForTimeRange(params: {
  userId: string;
  workspaceId: string;
  startTime: Date;
  endTime?: Date;
  aspects?: VoiceAspect[];
}): Promise<
  Array<{
    aspect: string;
    statementCount: number;
    statements: { fact: string; validAt: string; episodeUuids: string[] }[];
  }>
> {
  const ALL_VOICE_ASPECTS: VoiceAspect[] = [
    "Directive",
    "Preference",
    "Habit",
    "Belief",
    "Goal",
  ];
  const aspectsToQuery =
    params.aspects && params.aspects.length > 0
      ? params.aspects
      : ALL_VOICE_ASPECTS;

  const results = await Promise.all(
    aspectsToQuery.map(async (aspect) => {
      const records = await prisma.voiceAspect.findMany({
        where: {
          userId: params.userId,
          workspaceId: params.workspaceId,
          aspect,
          validAt: {
            gte: params.startTime,
            ...(params.endTime ? { lte: params.endTime } : {}),
          },
          invalidAt: null,
        },
        orderBy: { validAt: "desc" },
        take: 20,
        select: { id: true, fact: true, validAt: true, episodeUuids: true },
      });

      if (records.length === 0) return null;
      return {
        aspect,
        statementCount: records.length,
        statements: records.map((r) => ({
          fact: r.fact,
          validAt: r.validAt.toISOString(),
          episodeUuids: r.episodeUuids,
        })),
      };
    }),
  );

  return results.filter((r): r is NonNullable<typeof r> => r !== null);
}

/**
 * Delete voice aspect embeddings from vector provider
 */
export async function deleteVoiceAspectEmbeddings(
  aspectIds: string[],
): Promise<void> {
  if (aspectIds.length === 0) return;
  await vectorProvider().delete({
    ids: aspectIds,
    namespace: VECTOR_NAMESPACES.ASPECT,
  });
}
