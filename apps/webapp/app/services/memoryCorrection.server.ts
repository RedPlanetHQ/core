/**
 * Memory corrections
 *
 * Lets a user (or the agent / an MCP client, on the user's behalf) retire
 * wrong or stale memory facts, or replace them with a corrected fact.
 *
 * Every change is staged as a MemoryCorrection record first:
 *
 *   propose → PROPOSED ──apply──→ APPLIED ──restore──→ RESTORED
 *                      └─reject─→ REJECTED
 *
 * Nothing in memory changes until a correction is applied. Applying retires
 * the facts (graph statements in Neo4j, voice aspects in Postgres) with
 * invalidatedBy = "correction:<id>", the same soft invalidation ingestion
 * already uses, so history is kept and search stops returning them. For a
 * CORRECT action the corrected text is then ingested through the normal
 * pipeline. Restoring only clears invalidations made by that correction.
 */

import {
  MemoryCorrectionAction,
  MemoryCorrectionStatus,
  type MemoryCorrection,
} from "@core/database";
import { EpisodeTypeEnum } from "@core/types";

import { prisma } from "~/db.server";
import { addToQueue } from "~/lib/ingest.server";
import { getEmbedding } from "~/lib/model.server";
import {
  findSimilarVoiceAspects,
  getVoiceAspectsByIds,
  invalidateVoiceAspects,
  restoreVoiceAspects,
} from "~/services/aspectStore.server";
import {
  findSimilarStatements,
  getStatements,
  invalidateStatementsBatch,
  restoreInvalidatedStatements,
} from "~/services/graphModels/statement";
import { logger } from "~/services/logger.service";

export type MemoryFactKind = "statement" | "voice_aspect";

export interface MemoryFact {
  id: string;
  kind: MemoryFactKind;
  fact: string;
  aspect: string | null;
  validAt: string;
  score?: number;
}

export type MemoryCorrectionErrorCode =
  | "INVALID_INPUT"
  | "NOT_FOUND"
  | "INVALID_STATE"
  | "FACTS_NOT_CURRENT";

export class MemoryCorrectionError extends Error {
  constructor(
    public code: MemoryCorrectionErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "MemoryCorrectionError";
  }
}

/** Value written to invalidatedBy on facts retired by a correction. */
export function correctionTag(correctionId: string): string {
  return `correction:${correctionId}`;
}

const DEFAULT_FIND_THRESHOLD = 0.6;
const DEFAULT_SIMILAR_THRESHOLD = 0.85;
const MAX_FACTS_PER_CORRECTION = 50;
const MAX_SWEEP_SOURCES = 10;

interface Scope {
  userId: string;
  workspaceId: string;
}

/**
 * Find current memory facts that match a natural-language description,
 * so the caller can pick which ones to correct.
 */
export async function findFacts(
  params: Scope & { query: string; limit?: number; threshold?: number },
): Promise<MemoryFact[]> {
  const query = params.query.trim();
  if (!query) {
    throw new MemoryCorrectionError("INVALID_INPUT", "query is required");
  }
  const limit = params.limit ?? 20;
  const threshold = params.threshold ?? DEFAULT_FIND_THRESHOLD;

  const embedding = await getEmbedding(query);
  const [statements, aspects] = await Promise.all([
    findSimilarStatements({
      factEmbedding: embedding,
      threshold,
      userId: params.userId,
      workspaceId: params.workspaceId,
    }),
    findSimilarVoiceAspects({
      fact: query,
      userId: params.userId,
      workspaceId: params.workspaceId,
      threshold,
      limit,
    }),
  ]);

  const facts: MemoryFact[] = [
    ...statements
      .filter((s) => !s.invalidAt)
      .map((s) => ({
        id: s.uuid,
        kind: "statement" as const,
        fact: s.fact,
        aspect: s.aspect ?? null,
        validAt: new Date(s.validAt).toISOString(),
      })),
    ...aspects.map((a) => ({
      id: a.uuid,
      kind: "voice_aspect" as const,
      fact: a.fact,
      aspect: a.aspect,
      validAt: new Date(a.validAt).toISOString(),
      score: a.score,
    })),
  ];

  return facts.slice(0, limit);
}

/** Load the target facts, failing if any is missing or already retired. */
async function loadCurrentFacts(
  params: Scope & { statementIds: string[]; voiceAspectIds: string[] },
): Promise<MemoryFact[]> {
  const [statements, aspects] = await Promise.all([
    params.statementIds.length
      ? getStatements({
          statementUuids: params.statementIds,
          userId: params.userId,
          workspaceId: params.workspaceId,
        })
      : Promise.resolve([]),
    getVoiceAspectsByIds({
      ids: params.voiceAspectIds,
      userId: params.userId,
      workspaceId: params.workspaceId,
    }),
  ]);

  const current = new Map<string, MemoryFact>();
  for (const s of statements) {
    if (s.invalidAt) continue;
    current.set(s.uuid, {
      id: s.uuid,
      kind: "statement",
      fact: s.fact,
      aspect: s.aspect ?? null,
      validAt: new Date(s.validAt).toISOString(),
    });
  }
  for (const a of aspects) {
    if (a.invalidAt) continue;
    current.set(a.uuid, {
      id: a.uuid,
      kind: "voice_aspect",
      fact: a.fact,
      aspect: a.aspect,
      validAt: new Date(a.validAt).toISOString(),
    });
  }

  const missing = [...params.statementIds, ...params.voiceAspectIds].filter(
    (id) => !current.has(id),
  );
  if (missing.length > 0) {
    throw new MemoryCorrectionError(
      "FACTS_NOT_CURRENT",
      `These facts were not found or are no longer current: ${missing.join(", ")}`,
    );
  }

  return [...current.values()];
}

/**
 * Other current facts that say nearly the same thing as the targets.
 * A wrong fact usually has siblings; surfacing them lets the user fix all
 * of them in one correction instead of meeting them again later.
 */
async function findSimilarCurrentFacts(
  params: Scope & { targets: MemoryFact[]; threshold?: number },
): Promise<MemoryFact[]> {
  const threshold = params.threshold ?? DEFAULT_SIMILAR_THRESHOLD;
  const targetIds = new Set(params.targets.map((t) => t.id));
  const found = new Map<string, MemoryFact>();

  for (const target of params.targets.slice(0, MAX_SWEEP_SOURCES)) {
    const [statements, aspects] = await Promise.all([
      getEmbedding(target.fact).then((factEmbedding) =>
        findSimilarStatements({
          factEmbedding,
          threshold,
          excludeIds: [...targetIds],
          userId: params.userId,
          workspaceId: params.workspaceId,
        }),
      ),
      findSimilarVoiceAspects({
        fact: target.fact,
        userId: params.userId,
        workspaceId: params.workspaceId,
        threshold,
      }),
    ]);

    for (const s of statements) {
      if (s.invalidAt || targetIds.has(s.uuid) || found.has(s.uuid)) continue;
      found.set(s.uuid, {
        id: s.uuid,
        kind: "statement",
        fact: s.fact,
        aspect: s.aspect ?? null,
        validAt: new Date(s.validAt).toISOString(),
      });
    }
    for (const a of aspects) {
      if (targetIds.has(a.uuid) || found.has(a.uuid)) continue;
      found.set(a.uuid, {
        id: a.uuid,
        kind: "voice_aspect",
        fact: a.fact,
        aspect: a.aspect,
        validAt: new Date(a.validAt).toISOString(),
        score: a.score,
      });
    }
  }

  return [...found.values()];
}

/**
 * Stage a correction. Memory is not changed until applyCorrection.
 *
 * @returns the PROPOSED correction plus similar current facts the caller
 *   may want to add to it (they are not included automatically).
 */
export async function proposeCorrection(
  params: Scope & {
    action: MemoryCorrectionAction;
    statementIds?: string[];
    voiceAspectIds?: string[];
    reason?: string;
    correctedText?: string;
    proposedBy: string;
  },
): Promise<{ correction: MemoryCorrection; similar: MemoryFact[] }> {
  const statementIds = [...new Set(params.statementIds ?? [])];
  const voiceAspectIds = [...new Set(params.voiceAspectIds ?? [])];
  const correctedText = params.correctedText?.trim() || null;

  if (statementIds.length + voiceAspectIds.length === 0) {
    throw new MemoryCorrectionError(
      "INVALID_INPUT",
      "At least one statement or voice aspect id is required",
    );
  }
  if (statementIds.length + voiceAspectIds.length > MAX_FACTS_PER_CORRECTION) {
    throw new MemoryCorrectionError(
      "INVALID_INPUT",
      `A correction can change at most ${MAX_FACTS_PER_CORRECTION} facts`,
    );
  }
  if (params.action === MemoryCorrectionAction.CORRECT && !correctedText) {
    throw new MemoryCorrectionError(
      "INVALID_INPUT",
      "correctedText is required for a CORRECT action",
    );
  }

  const facts = await loadCurrentFacts({
    userId: params.userId,
    workspaceId: params.workspaceId,
    statementIds,
    voiceAspectIds,
  });

  const correction = await prisma.memoryCorrection.create({
    data: {
      action: params.action,
      status: MemoryCorrectionStatus.PROPOSED,
      reason: params.reason?.trim() || null,
      correctedText:
        params.action === MemoryCorrectionAction.CORRECT ? correctedText : null,
      statementIds,
      voiceAspectIds,
      facts: facts.map(({ id, kind, fact, aspect }) => ({
        id,
        kind,
        fact,
        aspect,
      })),
      proposedBy: params.proposedBy,
      userId: params.userId,
      workspaceId: params.workspaceId,
    },
  });

  let similar: MemoryFact[] = [];
  try {
    similar = await findSimilarCurrentFacts({
      userId: params.userId,
      workspaceId: params.workspaceId,
      targets: facts,
    });
  } catch (error) {
    // The sweep is advisory; a failure must not lose the proposal.
    logger.warn("Memory correction similar-fact sweep failed", {
      correctionId: correction.id,
      error,
    });
  }

  return { correction, similar };
}

/**
 * Move a correction from one status to another, atomically. Returns the
 * updated record, or throws if it does not exist or is in another state.
 */
async function transition(
  params: Scope & {
    id: string;
    from: MemoryCorrectionStatus;
    to: MemoryCorrectionStatus;
    data?: Record<string, unknown>;
  },
): Promise<MemoryCorrection> {
  const { count } = await prisma.memoryCorrection.updateMany({
    where: {
      id: params.id,
      userId: params.userId,
      workspaceId: params.workspaceId,
      status: params.from,
    },
    data: { status: params.to, ...params.data },
  });

  const record = await prisma.memoryCorrection.findFirst({
    where: {
      id: params.id,
      userId: params.userId,
      workspaceId: params.workspaceId,
    },
  });
  if (!record) {
    throw new MemoryCorrectionError("NOT_FOUND", "Correction not found");
  }
  if (count === 0) {
    throw new MemoryCorrectionError(
      "INVALID_STATE",
      `Correction is ${record.status}, expected ${params.from}`,
    );
  }
  return record;
}

/**
 * Apply a PROPOSED correction: retire its facts and, for CORRECT, ingest
 * the corrected text. If any step fails the retirements are undone and the
 * correction goes back to PROPOSED.
 */
export async function applyCorrection(params: Scope & { id: string }): Promise<{
  correction: MemoryCorrection;
  retiredStatementIds: string[];
  retiredVoiceAspectCount: number;
}> {
  const scope = { userId: params.userId, workspaceId: params.workspaceId };
  const claimed = await transition({
    ...scope,
    id: params.id,
    from: MemoryCorrectionStatus.PROPOSED,
    to: MemoryCorrectionStatus.APPLIED,
    data: { appliedAt: new Date() },
  });
  const tag = correctionTag(claimed.id);

  try {
    const retiredStatementIds = await invalidateStatementsBatch({
      statementIds: claimed.statementIds,
      invalidatedBy: tag,
      ...scope,
    });
    const retiredVoiceAspectCount = await invalidateVoiceAspects({
      ids: claimed.voiceAspectIds,
      invalidatedBy: tag,
      ...scope,
    });

    let ingestionQueueId: string | null = null;
    if (
      claimed.action === MemoryCorrectionAction.CORRECT &&
      claimed.correctedText
    ) {
      // Only the corrected fact is ingested, never the old one, so
      // extraction cannot recreate what was just retired.
      const queued = await addToQueue(
        {
          episodeBody: `Correction from the user: ${claimed.correctedText}`,
          referenceTime: new Date().toISOString(),
          source: "correction",
          type: EpisodeTypeEnum.CONVERSATION,
          metadata: { correctionId: claimed.id },
        },
        params.userId,
        params.workspaceId,
      );
      ingestionQueueId = queued.id ?? null;
    }

    const correction = await prisma.memoryCorrection.update({
      where: { id: claimed.id },
      data: { ingestionQueueId },
    });

    return { correction, retiredStatementIds, retiredVoiceAspectCount };
  } catch (error) {
    logger.error("Applying memory correction failed; rolling back", {
      correctionId: claimed.id,
      error,
    });
    await restoreInvalidatedStatements({
      statementIds: claimed.statementIds,
      invalidatedBy: tag,
      ...scope,
    });
    await restoreVoiceAspects({
      ids: claimed.voiceAspectIds,
      invalidatedBy: tag,
      ...scope,
    });
    await prisma.memoryCorrection.update({
      where: { id: claimed.id },
      data: { status: MemoryCorrectionStatus.PROPOSED, appliedAt: null },
    });
    throw error;
  }
}

/** Reject a PROPOSED correction. Memory is not changed. */
export async function rejectCorrection(
  params: Scope & { id: string },
): Promise<MemoryCorrection> {
  return transition({
    ...params,
    from: MemoryCorrectionStatus.PROPOSED,
    to: MemoryCorrectionStatus.REJECTED,
    data: { rejectedAt: new Date() },
  });
}

/**
 * Undo an APPLIED correction: make its retired facts current again.
 *
 * Facts retired by something else since then stay retired. The episode
 * ingested from correctedText is not removed here; its ingestion id is on
 * the returned record so the caller can delete it if wanted.
 */
export async function restoreCorrection(
  params: Scope & { id: string },
): Promise<{
  correction: MemoryCorrection;
  restoredStatementIds: string[];
  restoredVoiceAspectCount: number;
}> {
  const scope = { userId: params.userId, workspaceId: params.workspaceId };
  const claimed = await transition({
    ...scope,
    id: params.id,
    from: MemoryCorrectionStatus.APPLIED,
    to: MemoryCorrectionStatus.RESTORED,
    data: { restoredAt: new Date() },
  });
  const tag = correctionTag(claimed.id);

  try {
    const restoredStatementIds = await restoreInvalidatedStatements({
      statementIds: claimed.statementIds,
      invalidatedBy: tag,
      ...scope,
    });
    const restoredVoiceAspectCount = await restoreVoiceAspects({
      ids: claimed.voiceAspectIds,
      invalidatedBy: tag,
      ...scope,
    });
    return {
      correction: claimed,
      restoredStatementIds,
      restoredVoiceAspectCount,
    };
  } catch (error) {
    await prisma.memoryCorrection.update({
      where: { id: claimed.id },
      data: { status: MemoryCorrectionStatus.APPLIED, restoredAt: null },
    });
    throw error;
  }
}

/** List corrections in a workspace, newest first. */
export async function listCorrections(
  params: Scope & { status?: MemoryCorrectionStatus; limit?: number },
): Promise<MemoryCorrection[]> {
  return prisma.memoryCorrection.findMany({
    where: {
      userId: params.userId,
      workspaceId: params.workspaceId,
      ...(params.status ? { status: params.status } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: Math.min(params.limit ?? 50, 200),
  });
}
