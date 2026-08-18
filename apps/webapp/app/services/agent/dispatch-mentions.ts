/**
 * Mention router — the connective tissue that turns
 * `<mention colleague="cass" />` in a ConversationHistory row into a
 * background turn for Cass on that conversation.
 *
 * Call this after any row lands (user message or agent reply). We parse
 * the row's parts for mentions, resolve each slug to an agent, and for
 * each target:
 *
 *   1. Race-guard: if the target already has an in-flight row on this
 *      conversation, cancel its background job and soft-delete the row
 *      (deleted=now, status="cancelled"). "Fresh instruction wins."
 *   2. Depth-guard: if the source row's delegationDepth is already at
 *      the cap, log and skip — bounded agent↔agent fan-out.
 *   3. Reserve a placeholder row (status="working", agentId=target).
 *   4. Enqueue `run-agent-turn`, then patch the placeholder with the
 *      returned asyncJobId so a later mention can cancel it.
 *
 * When a specialist reply lands with no mentions, we don't try to guess
 * "who was the caller" from the agent's role — instead we walk up the
 * trigger chain via each placeholder's stored `triggeredByAgentId` and
 * wake the *root* agent (the one whose placeholder was invoked directly
 * by the user). If the just-finished specialist itself was invoked by
 * the user, the thread simply ends — the human will reply if they want
 * to continue.
 *
 * Fire-and-forget from the caller's perspective — dispatch returns as
 * soon as jobs are enqueued.
 */

import { UserTypeEnum } from "@core/types";

import { prisma } from "~/db.server";
import { logger } from "~/services/logger.service";
import { parseMentions, resolveColleague } from "./mentions";
import { cancelJob } from "~/services/jobManager.server";
import { enqueueAgentTurn } from "~/lib/queue-adapter.server";
import { upsertConversationHistory } from "~/services/conversation.server";

/** Max depth of agent↔agent mention chains. User-initiated mentions start
 *  at 0; each downstream mention increments. Beyond this, dispatch logs
 *  and drops the mention. Buzz-inspired: allow chains, bound them. */
export const MAX_DELEGATION_DEPTH = 3;

interface DispatchMentionsParams {
  /** The row that just landed and may contain mentions. */
  sourceRow: {
    id: string;
    conversationId: string;
    workspaceId: string;
    parts: unknown;
    /** Depth of this row. 0 for user messages; N for a mention chain N deep. */
    delegationDepth: number;
    /** The agent who authored this row, if any. Used so a specialist can't
     *  accidentally wake themselves by mentioning their own handle, and
     *  recorded on each spawned placeholder as `triggeredByAgentId` so the
     *  chain-resume logic below can trace back to the root. */
    authorAgentId?: string | null;
  };
}

/** Collaboration only works inside task-scoped conversations. Agent 1:1
 *  chats treat mentions as inert prose — the picker is hidden in the UI,
 *  the parser is bypassed here, and the base prompt tells the agent so.
 *  Signals: source === "task" or an asyncJobId set. Either is sufficient.
 *  Kept as a helper so all call sites stay in sync. */
export async function conversationAllowsCollaboration(
  conversationId: string,
): Promise<{ allowed: boolean; ownerAgentId: string | null }> {
  const conv = await prisma.conversation.findUnique({
    where: { id: conversationId },
    select: { asyncJobId: true, source: true, agentId: true },
  });
  if (!conv) return { allowed: false, ownerAgentId: null };
  const allowed = conv.source === "task" || !!conv.asyncJobId;
  return { allowed, ownerAgentId: conv.agentId ?? null };
}

interface DispatchedTurn {
  agentId: string;
  handle: string;
  placeholderRowId: string;
  asyncJobId?: string;
  cancelledPriorRowId?: string;
}

/** Metadata shape we write onto every placeholder's `thoughts` field so
 *  the chain-resume walk can trace back through prior turns. Kept
 *  optional / lenient because legacy rows (written before this refactor)
 *  won't have `triggeredByAgentId` set. */
interface PlaceholderThoughts {
  startedAt?: string;
  /** ConversationHistory.id of the row that triggered this placeholder
   *  — either the user's message or the prior agent's reply that
   *  contained the mention. */
  triggeredBy?: string;
  /** The agent that authored the triggering row, or null if the trigger
   *  was a user message. Missing (undefined) on legacy rows — treated
   *  as unknown by the walker (fail-closed → no resume). */
  triggeredByAgentId?: string | null;
  /** Free-form marker used for observability. */
  trigger?: string;
}

export async function dispatchMentions(
  params: DispatchMentionsParams,
): Promise<DispatchedTurn[]> {
  const { sourceRow } = params;

  // Scope gate: only task-linked conversations allow multi-agent
  // collaboration. In 1:1 agent chats every mention is inert prose.
  const scope = await conversationAllowsCollaboration(sourceRow.conversationId);
  if (!scope.allowed) return [];

  const slugs = parseMentions(sourceRow.parts);
  const results: DispatchedTurn[] = [];

  // Silent reply from an agent — resolve the "root agent" of the chain
  // by walking up each placeholder's triggeredByAgentId. If the chain's
  // root was invoked directly by the user (or if this specialist itself
  // was user-invoked), no auto-resume — the human's turn is next.
  if (slugs.length === 0) {
    if (!sourceRow.authorAgentId) return [];
    return dispatchChainResume({ sourceRow });
  }

  for (const slug of slugs) {
    const target = await resolveColleague(sourceRow.workspaceId, slug);
    if (!target) {
      logger.info("dispatchMentions: unresolved slug", {
        slug,
        conversationId: sourceRow.conversationId,
      });
      continue;
    }
    // Self-mention: the specialist tagged their own handle. No-op.
    if (sourceRow.authorAgentId && target.id === sourceRow.authorAgentId) {
      continue;
    }

    const nextDepth = sourceRow.delegationDepth + 1;
    if (nextDepth > MAX_DELEGATION_DEPTH) {
      logger.warn("dispatchMentions: depth cap hit", {
        slug,
        conversationId: sourceRow.conversationId,
        sourceDepth: sourceRow.delegationDepth,
      });
      continue;
    }

    // Race-guard + supersede. Any existing working row for this
    // (conversation, agent) is cancelled: kill its background job, then
    // soft-delete the row. We keep the row (deleted=now, not a real
    // delete) so debugging "did Cass send the email before we cancelled"
    // stays possible via `deleted != null` queries.
    const inFlight = await prisma.conversationHistory.findFirst({
      where: {
        conversationId: sourceRow.conversationId,
        agentId: target.id,
        status: "working",
        deleted: null,
      },
      select: { id: true, asyncJobId: true },
      orderBy: { createdAt: "desc" },
    });
    let cancelledPriorRowId: string | undefined;
    if (inFlight) {
      if (inFlight.asyncJobId) {
        try {
          await cancelJob(inFlight.asyncJobId);
        } catch (err) {
          logger.warn("dispatchMentions: cancel job failed (superseding anyway)", {
            error: err instanceof Error ? err.message : String(err),
            jobId: inFlight.asyncJobId,
          });
        }
      }
      await prisma.conversationHistory.update({
        where: { id: inFlight.id },
        data: {
          status: "cancelled",
          deleted: new Date(),
        },
      });
      cancelledPriorRowId = inFlight.id;
    }

    // Reserve the placeholder row. asyncJobId is filled in below once we
    // have a handle from the queue — the two-step insert-then-patch is
    // fine because dispatchMentions is the only caller that races on
    // this row (and it serializes per target above).
    const placeholderId = crypto.randomUUID();
    try {
      const thoughts: PlaceholderThoughts = {
        startedAt: new Date().toISOString(),
        triggeredBy: sourceRow.id,
        triggeredByAgentId: sourceRow.authorAgentId ?? null,
      };
      await upsertConversationHistory(
        placeholderId,
        [
          {
            type: "text",
            text: `_${target.displayName} is working on it…_`,
          },
        ],
        sourceRow.conversationId,
        UserTypeEnum.Agent,
        true,
        thoughts as unknown as Record<string, unknown>,
        target.id,
      );
      await prisma.conversationHistory.update({
        where: { id: placeholderId },
        data: {
          status: "working",
          delegationDepth: nextDepth,
        },
      });
    } catch (err) {
      logger.error("dispatchMentions: failed to reserve placeholder", {
        error: err,
        slug,
        conversationId: sourceRow.conversationId,
      });
      continue;
    }

    let asyncJobId: string | undefined;
    try {
      const enq = await enqueueAgentTurn({
        conversationId: sourceRow.conversationId,
        agentId: target.id,
        placeholderRowId: placeholderId,
        delegationDepth: nextDepth,
      });
      asyncJobId = enq.id;
      if (asyncJobId) {
        await prisma.conversationHistory.update({
          where: { id: placeholderId },
          data: { asyncJobId },
        });
      }
    } catch (err) {
      logger.error("dispatchMentions: enqueue failed", {
        error: err,
        slug,
        conversationId: sourceRow.conversationId,
      });
      await prisma.conversationHistory.update({
        where: { id: placeholderId },
        data: {
          status: "error",
          deleted: new Date(),
        },
      });
      continue;
    }

    results.push({
      agentId: target.id,
      handle: target.handle,
      placeholderRowId: placeholderId,
      asyncJobId,
      cancelledPriorRowId,
    });
  }

  return results;
}

/**
 * Chain-resume: after a specialist finishes a turn with no mentions,
 * walk back up the trigger chain to find the root agent (the one whose
 * placeholder was invoked directly by the user) and enqueue a fresh
 * turn for them.
 *
 * The walk starts at the specialist's own most-recent placeholder,
 * reads `thoughts.triggeredByAgentId`. If null → the specialist was
 * user-invoked → no resume. Otherwise follow `thoughts.triggeredBy` up
 * to the parent placeholder and repeat until the parent chain hits a
 * placeholder whose `triggeredByAgentId` is null — that placeholder's
 * agent is the root.
 *
 * Legacy placeholders without `triggeredByAgentId` in `thoughts` stop
 * the walk (fail-closed) so we don't wake the owner based on stale
 * heuristics.
 */
async function dispatchChainResume(params: {
  sourceRow: DispatchMentionsParams["sourceRow"];
}): Promise<DispatchedTurn[]> {
  const { sourceRow } = params;

  const rootAgentId = await resolveChainRootAgent(sourceRow.id);
  if (!rootAgentId) {
    logger.debug("dispatchChainResume: no root agent to resume", {
      conversationId: sourceRow.conversationId,
      sourceRowId: sourceRow.id,
    });
    return [];
  }

  // Don't resume ourselves — the specialist that just finished IS the
  // chain root (e.g. user@Cass → Cass silent). The empty-mention branch
  // above already returns [] for that shape, but keep a belt-and-braces
  // guard here in case chain traversal leads back to the current agent
  // for any reason.
  if (rootAgentId === sourceRow.authorAgentId) {
    return [];
  }

  const owner = await prisma.agents.findFirst({
    where: { id: rootAgentId, status: "Active" },
    select: { id: true, handle: true, displayName: true },
  });
  if (!owner) {
    logger.info("dispatchChainResume: root agent missing or inactive", {
      conversationId: sourceRow.conversationId,
      rootAgentId,
    });
    return [];
  }

  const nextDepth = sourceRow.delegationDepth + 1;
  if (nextDepth > MAX_DELEGATION_DEPTH) {
    logger.warn("dispatchChainResume: depth cap hit", {
      conversationId: sourceRow.conversationId,
      sourceDepth: sourceRow.delegationDepth,
    });
    return [];
  }

  // Race-guard: if the root already has a working turn on this
  // conversation, supersede it — the resume is a fresh instruction
  // that overrides any prior in-flight turn for the same agent.
  const inFlight = await prisma.conversationHistory.findFirst({
    where: {
      conversationId: sourceRow.conversationId,
      agentId: owner.id,
      status: "working",
      deleted: null,
    },
    select: { id: true, asyncJobId: true },
    orderBy: { createdAt: "desc" },
  });
  let cancelledPriorRowId: string | undefined;
  if (inFlight) {
    if (inFlight.asyncJobId) {
      try {
        await cancelJob(inFlight.asyncJobId);
      } catch (err) {
        logger.warn(
          "dispatchChainResume: cancel prior job failed (superseding anyway)",
          {
            error: err instanceof Error ? err.message : String(err),
            jobId: inFlight.asyncJobId,
          },
        );
      }
    }
    await prisma.conversationHistory.update({
      where: { id: inFlight.id },
      data: { status: "cancelled", deleted: new Date() },
    });
    cancelledPriorRowId = inFlight.id;
  }

  const placeholderId = crypto.randomUUID();
  try {
    const thoughts: PlaceholderThoughts = {
      startedAt: new Date().toISOString(),
      triggeredBy: sourceRow.id,
      triggeredByAgentId: sourceRow.authorAgentId ?? null,
      trigger: "chain-resume",
    };
    await upsertConversationHistory(
      placeholderId,
      [
        {
          type: "text",
          text: `_${owner.displayName} is picking this up…_`,
        },
      ],
      sourceRow.conversationId,
      UserTypeEnum.Agent,
      true,
      thoughts as unknown as Record<string, unknown>,
      owner.id,
    );
    await prisma.conversationHistory.update({
      where: { id: placeholderId },
      data: { status: "working", delegationDepth: nextDepth },
    });
  } catch (err) {
    logger.error("dispatchChainResume: reserve placeholder failed", {
      error: err,
      conversationId: sourceRow.conversationId,
    });
    return [];
  }

  let asyncJobId: string | undefined;
  try {
    const enq = await enqueueAgentTurn({
      conversationId: sourceRow.conversationId,
      agentId: owner.id,
      placeholderRowId: placeholderId,
      delegationDepth: nextDepth,
    });
    asyncJobId = enq.id;
    if (asyncJobId) {
      await prisma.conversationHistory.update({
        where: { id: placeholderId },
        data: { asyncJobId },
      });
    }
  } catch (err) {
    logger.error("dispatchChainResume: enqueue failed", {
      error: err,
      conversationId: sourceRow.conversationId,
    });
    await prisma.conversationHistory.update({
      where: { id: placeholderId },
      data: { status: "error", deleted: new Date() },
    });
    return [];
  }

  return [
    {
      agentId: owner.id,
      handle: owner.handle,
      placeholderRowId: placeholderId,
      asyncJobId,
      cancelledPriorRowId,
    },
  ];
}

/**
 * Walk up the trigger chain from `sourceRowId` (a just-finished agent
 * reply) and return the id of the *root agent* — the one whose
 * placeholder was invoked directly by the user's message. Returns null
 * when:
 *   - the source row itself was user-invoked (`triggeredByAgentId` is
 *     null) — thread should just end,
 *   - a placeholder in the chain is missing `triggeredByAgentId` (legacy
 *     row) — fail-closed to avoid waking the wrong agent,
 *   - the walk exceeds a safety cap.
 */
async function resolveChainRootAgent(
  sourceRowId: string,
): Promise<string | null> {
  // Safety bound — real chains are capped by MAX_DELEGATION_DEPTH but
  // the walk can go one hop further, and legacy rows without valid
  // triggeredBy would otherwise loop.
  const SAFETY_HOPS = MAX_DELEGATION_DEPTH + 2;

  let currentId: string | null = sourceRowId;
  let previousAgentId: string | null = null;

  for (let hop = 0; hop < SAFETY_HOPS; hop++) {
    if (!currentId) return null;
    const current = await prisma.conversationHistory.findUnique({
      where: { id: currentId },
      select: {
        id: true,
        agentId: true,
        userType: true,
        thoughts: true,
      },
    });
    if (!current) return null;

    // Reached the user message that started the chain — the previous
    // step (the agent placeholder directly under this row) is the root.
    if (current.userType !== "Agent") {
      return previousAgentId;
    }

    const meta = (current.thoughts ?? null) as PlaceholderThoughts | null;
    const parentAgentId = meta?.triggeredByAgentId;

    // No metadata on this placeholder — legacy row. Can't trace safely;
    // fail closed rather than guessing.
    if (parentAgentId === undefined) return null;

    // Placeholder was invoked directly by the user (agent id is null on
    // triggeredByAgentId) — this row's owning agent IS the root.
    if (parentAgentId === null) {
      return current.agentId ?? null;
    }

    // Otherwise walk up to the parent placeholder.
    previousAgentId = current.agentId ?? null;
    currentId = meta?.triggeredBy ?? null;
  }

  return null;
}
