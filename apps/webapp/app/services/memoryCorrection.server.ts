/**
 * Memory corrections
 *
 * Lets a user (or the agent / an MCP client, on the user's behalf) retire
 * wrong or stale memory facts, or replace them with a corrected fact.
 *
 * Every change is staged as a MemoryCorrection record first:
 *
 *   propose → PROPOSED ──apply──→ APPLYING → APPLIED ──restore──→ RESTORING → RESTORED
 *                      └─reject─→ REJECTED        ↓                         ↓
 *                                              FAILED ←────────────────────┘
 *
 * APPLYING / RESTORING mark an operation in progress and double as a lock;
 * FAILED means an undo stopped partway and restore can finish it.
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
 * How long an APPLYING / RESTORING correction may sit before restore treats
 * it as abandoned (the process died mid-operation) and may take it over.
 */
export const STALE_IN_PROGRESS_MS = 10 * 60 * 1000;

/**
 * Atomically move a correction to `to` if its status is one of `from`
 * (or, with `staleFrom`, one of those statuses not updated for
 * STALE_IN_PROGRESS_MS). The conditional update and the read run in one
 * transaction, so the returned record always reflects the update.
 *
 * Statuses act as a per-correction lock: APPLYING and RESTORING are only
 * entered from states no other operation accepts, so apply and restore on
 * the same correction can never overlap.
 */
async function transition(
  params: Scope & {
    id: string;
    from: MemoryCorrectionStatus[];
    staleFrom?: MemoryCorrectionStatus[];
    to: MemoryCorrectionStatus;
    data?: Record<string, unknown>;
  },
): Promise<MemoryCorrection> {
  const owner = {
    id: params.id,
    userId: params.userId,
    workspaceId: params.workspaceId,
  };
  const staleCutoff = new Date(Date.now() - STALE_IN_PROGRESS_MS);

  const [{ count }, record] = await prisma.$transaction([
    prisma.memoryCorrection.updateMany({
      where: {
        ...owner,
        OR: [
          { status: { in: params.from } },
          ...(params.staleFrom?.length
            ? [
                {
                  status: { in: params.staleFrom },
                  updatedAt: { lt: staleCutoff },
                },
              ]
            : []),
        ],
      },
      data: { status: params.to, ...params.data },
    }),
    prisma.memoryCorrection.findFirst({ where: owner }),
  ]);

  if (!record) {
    throw new MemoryCorrectionError("NOT_FOUND", "Correction not found");
  }
  if (count === 0) {
    throw new MemoryCorrectionError(
      "INVALID_STATE",
      `Correction is ${record.status}, expected ${params.from.join(" or ")}`,
    );
  }
  return record;
}

/**
 * Undo this correction's invalidations in both stores. Every step is
 * attempted even if another fails.
 *
 * @returns whether every step succeeded, plus what was restored
 */
async function restoreTaggedFacts(
  scope: Scope,
  correction: MemoryCorrection,
): Promise<{
  ok: boolean;
  restoredStatementIds: string[];
  restoredVoiceAspectCount: number;
}> {
  const tag = correctionTag(correction.id);
  const [statements, aspects] = await Promise.allSettled([
    restoreInvalidatedStatements({
      statementIds: correction.statementIds,
      invalidatedBy: tag,
      ...scope,
    }),
    restoreVoiceAspects({
      ids: correction.voiceAspectIds,
      invalidatedBy: tag,
      ...scope,
    }),
  ]);

  for (const result of [statements, aspects]) {
    if (result.status === "rejected") {
      logger.error("Restoring memory correction facts failed", {
        correctionId: correction.id,
        error: result.reason,
      });
    }
  }

  return {
    ok: statements.status === "fulfilled" && aspects.status === "fulfilled",
    restoredStatementIds:
      statements.status === "fulfilled" ? statements.value : [],
    restoredVoiceAspectCount:
      aspects.status === "fulfilled" ? aspects.value : 0,
  };
}

/** Best-effort status write used on failure paths; never throws. */
async function setStatusQuietly(
  id: string,
  data: Record<string, unknown>,
): Promise<void> {
  try {
    await prisma.memoryCorrection.update({ where: { id }, data });
  } catch (error) {
    logger.error("Updating memory correction status failed", { id, error });
  }
}

/**
 * Apply a PROPOSED correction: retire its facts and, for CORRECT, ingest
 * the corrected text.
 *
 * - Fails before the corrected text is queued: the retirements are undone
 *   and the correction returns to PROPOSED (or FAILED if the undo itself
 *   failed; restoreCorrection can finish it).
 * - Once the corrected text is queued, the correction counts as applied:
 *   a queued ingestion cannot be taken back, so later errors never revive
 *   the old facts or make the correction retryable.
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
    from: [MemoryCorrectionStatus.PROPOSED],
    to: MemoryCorrectionStatus.APPLYING,
  });
  const tag = correctionTag(claimed.id);

  let retiredStatementIds: string[];
  let retiredVoiceAspectCount: number;
  let ingestionQueueId: string | null = null;

  try {
    retiredStatementIds = await invalidateStatementsBatch({
      statementIds: claimed.statementIds,
      invalidatedBy: tag,
      ...scope,
    });
    retiredVoiceAspectCount = await invalidateVoiceAspects({
      ids: claimed.voiceAspectIds,
      invalidatedBy: tag,
      ...scope,
    });

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
      ingestionQueueId = queued.ingestionQueueId;
    }
  } catch (error) {
    logger.error("Applying memory correction failed; rolling back", {
      correctionId: claimed.id,
      error,
    });
    const { ok } = await restoreTaggedFacts(scope, claimed);
    await setStatusQuietly(
      claimed.id,
      ok
        ? { status: MemoryCorrectionStatus.PROPOSED }
        : { status: MemoryCorrectionStatus.FAILED },
    );
    throw error;
  }

  // Past this point the change is committed. If recording it fails, the
  // correction stays APPLYING; restoreCorrection can take it over once it
  // is stale, and the ingestion can be found by metadata.correctionId.
  const correction = await prisma.memoryCorrection.update({
    where: { id: claimed.id },
    data: {
      status: MemoryCorrectionStatus.APPLIED,
      appliedAt: new Date(),
      ingestionQueueId,
    },
  });

  return { correction, retiredStatementIds, retiredVoiceAspectCount };
}

/** Reject a PROPOSED correction. Memory is not changed. */
export async function rejectCorrection(
  params: Scope & { id: string },
): Promise<MemoryCorrection> {
  return transition({
    ...params,
    from: [MemoryCorrectionStatus.PROPOSED],
    to: MemoryCorrectionStatus.REJECTED,
    data: { rejectedAt: new Date() },
  });
}

/**
 * Undo an APPLIED correction: make its retired facts current again.
 *
 * Also finishes a FAILED correction, or one stuck APPLYING / RESTORING
 * after a crash. It is safe to retry: only facts still tagged with this
 * correction are touched, and facts retired by anything else since stay
 * retired. If any step fails the correction is left FAILED for a retry.
 *
 * The episode ingested from correctedText is not removed here; its
 * ingestion id is on the record so the caller can delete it if wanted.
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
    from: [MemoryCorrectionStatus.APPLIED, MemoryCorrectionStatus.FAILED],
    staleFrom: [
      MemoryCorrectionStatus.APPLYING,
      MemoryCorrectionStatus.RESTORING,
    ],
    to: MemoryCorrectionStatus.RESTORING,
  });

  const { ok, restoredStatementIds, restoredVoiceAspectCount } =
    await restoreTaggedFacts(scope, claimed);

  if (!ok) {
    await setStatusQuietly(claimed.id, {
      status: MemoryCorrectionStatus.FAILED,
    });
    throw new MemoryCorrectionError(
      "INVALID_STATE",
      "Restoring the correction failed partway; it is marked FAILED and can be retried",
    );
  }

  const correction = await prisma.memoryCorrection.update({
    where: { id: claimed.id },
    data: { status: MemoryCorrectionStatus.RESTORED, restoredAt: new Date() },
  });

  return { correction, restoredStatementIds, restoredVoiceAspectCount };
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
