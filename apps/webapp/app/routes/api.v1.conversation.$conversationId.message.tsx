/**
 * `POST /api/v1/conversation/:conversationId/message` — the
 * non-streaming send endpoint.
 *
 * Client generates a UUID for the row up-front so it can insert
 * optimistically and dedup against the SSE echo. Server persists the
 * row (which auto-publishes to `conv:{id}` via
 * conversation-pubsub.server), then enqueues the conversation owner's
 * turn as a background job (`enqueueAgentTurn`). Returns immediately
 * with the persisted id + createdAt.
 *
 * Replaces the useChat streaming path for the web chat. Multi-agent
 * fan-out and the working→done placeholder lifecycle all happen via
 * the same SSE subscribe channel — see conversation-pubsub.server.ts
 * and the subscribe route.
 */

import { json } from "@remix-run/node";
import { z } from "zod";
import { UserTypeEnum } from "@core/types";

import { createHybridActionApiRoute } from "~/services/routeBuilders/apiBuilder.server";
import { prisma } from "~/db.server";
import {
  updateConversationStatus,
  upsertConversationHistory,
} from "~/services/conversation.server";
import { getGeneralistAgent } from "~/services/agent.server";
import { enqueueAgentTurn } from "~/lib/queue-adapter.server";
import { logger } from "~/services/logger.service";
import {
  conversationAllowsCollaboration,
  dispatchMentions,
} from "~/services/agent/dispatch-mentions";
import { parseMentions } from "~/services/agent/mentions";

const ParamsSchema = z.object({
  conversationId: z.string(),
});

const PartSchema = z
  .object({
    type: z.string(),
  })
  .passthrough();

const BodySchema = z.object({
  /** Client-generated uuid. Server upserts on this id so the optimistic
   *  row the client already rendered can be dedup'd when the SSE echo
   *  arrives. */
  id: z.string().min(1),
  parts: z.array(PartSchema).min(1),
});

const { action } = createHybridActionApiRoute(
  {
    params: ParamsSchema,
    body: BodySchema,
    method: "POST",
    allowJWT: true,
    corsStrategy: "all",
  },
  async ({ authentication, params, body }) => {
    const workspaceId = authentication.workspaceId as string | undefined;
    if (!workspaceId) {
      return json({ error: "unauthorized" }, { status: 401 });
    }

    // Ownership + owning-agent lookup in one query so we know who to
    // enqueue. If the conversation has no explicit agentId (legacy),
    // fall back to the workspace generalist — mirrors what task.logic
    // does in the same "who takes this turn" decision.
    const conv = await prisma.conversation.findFirst({
      where: {
        id: params.conversationId,
        userId: authentication.userId,
        deleted: null,
      },
      select: { id: true, agentId: true },
    });
    if (!conv) {
      return json({ error: "conversation not found" }, { status: 404 });
    }

    let ownerAgentId = conv.agentId;
    if (!ownerAgentId) {
      const generalist = await getGeneralistAgent(workspaceId);
      ownerAgentId = generalist?.id ?? null;
    }
    if (!ownerAgentId) {
      logger.error("send-message: no owner agent resolvable", {
        conversationId: params.conversationId,
      });
      return json({ error: "no owner agent" }, { status: 500 });
    }

    // Persist the user message. upsertConversationHistory publishes to
    // conv:{id} on Redis after the write commits — SSE subscribers
    // receive the row echo and dedup against their optimistic insert
    // by matching this id.
    const now = new Date();
    await upsertConversationHistory(
      body.id,
      body.parts,
      params.conversationId,
      UserTypeEnum.User,
      false,
    );

    // Mark the conversation "running" so any status-derived spinner in
    // the UI shows immediately. run-agent-turn flips it back to
    // "completed" in a finally when the job wraps.
    await updateConversationStatus(params.conversationId, "running");

    // Mention-vs-owner routing. In a collaboration-enabled conversation
    // (task or async-job scoped) a user @-mention should wake ONLY the
    // mentioned agent(s) — not the owner. Otherwise the generalist
    // interrupts the specialist you just tagged and starts reasoning
    // about the mention as prose (past incident: generalist tried to
    // reach @Cass via the Personal-computer gateway MCP).
    //
    // Falls back to owner-enqueue if no mention resolves — so a stray
    // "@somebody" that doesn't match any agent still gets a reply.
    const scope = await conversationAllowsCollaboration(params.conversationId);
    if (scope.allowed && parseMentions(body.parts).length > 0) {
      const dispatched = await dispatchMentions({
        sourceRow: {
          id: body.id,
          conversationId: params.conversationId,
          workspaceId,
          parts: body.parts,
          delegationDepth: 0,
          authorAgentId: null,
        },
      });
      if (dispatched.length > 0) {
        return json({
          id: body.id,
          createdAt: now.toISOString(),
          placeholderRowId: dispatched[0].placeholderRowId,
          asyncJobId: dispatched[0].asyncJobId,
        });
      }
      // No mention resolved (typo / unknown handle) — fall through to
      // the owner-enqueue path so the user still gets a response.
    }

    // Reserve the owner's placeholder row + enqueue their turn. Same
    // shape as dispatchMentions' owner-follow-up path so the SSE
    // subscriber sees the working→done transition on a single stable
    // row id.
    const placeholderId = crypto.randomUUID();
    await upsertConversationHistory(
      placeholderId,
      [{ type: "text", text: `_Working…_` }],
      params.conversationId,
      UserTypeEnum.Agent,
      true,
      {
        startedAt: now.toISOString(),
        triggeredBy: body.id,
      },
      ownerAgentId,
    );
    await prisma.conversationHistory.update({
      where: { id: placeholderId },
      data: { status: "working", delegationDepth: 0 },
    });

    let asyncJobId: string | undefined;
    try {
      const enq = await enqueueAgentTurn({
        conversationId: params.conversationId,
        agentId: ownerAgentId,
        placeholderRowId: placeholderId,
        delegationDepth: 0,
      });
      asyncJobId = enq.id;
      if (asyncJobId) {
        await prisma.conversationHistory.update({
          where: { id: placeholderId },
          data: { asyncJobId },
        });
      }
    } catch (err) {
      logger.error("send-message: enqueue owner turn failed", {
        err,
        conversationId: params.conversationId,
      });
      await prisma.conversationHistory.update({
        where: { id: placeholderId },
        data: { status: "error", deleted: new Date() },
      });
      await updateConversationStatus(params.conversationId, "completed");
      return json({ error: "failed to schedule reply" }, { status: 502 });
    }

    return json({
      id: body.id,
      createdAt: now.toISOString(),
      placeholderRowId: placeholderId,
      asyncJobId,
    });
  },
);

export { action };
