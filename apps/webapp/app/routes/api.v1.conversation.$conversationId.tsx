import { json } from "@remix-run/node";
import { z } from "zod";

import { createHybridLoaderApiRoute } from "~/services/routeBuilders/apiBuilder.server";
import {
  CONVERSATION_PAGE_SIZE,
  getConversationHistoryPage,
} from "~/services/conversation.server";

const ParamsSchema = z.object({
  conversationId: z.string(),
});

/**
 * `before` is the opaque keyset cursor returned as `nextCursor` — pass it
 * back to walk further up the thread. Omit it for the newest page, which is
 * what the chat opens on and what the live refetch re-reads.
 */
const SearchParamsSchema = z.object({
  before: z.string().optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
});

const loader = createHybridLoaderApiRoute(
  {
    params: ParamsSchema,
    searchParams: SearchParamsSchema,
    allowJWT: true,
    corsStrategy: "all",
    findResource: async () => 1,
  },
  async ({ authentication, params, searchParams }) => {
    const conversation = await getConversationHistoryPage(
      params.conversationId,
      authentication.userId,
      {
        before: searchParams.before,
        limit: searchParams.limit ?? CONVERSATION_PAGE_SIZE,
      },
    );

    if (!conversation) {
      return json({ error: "Conversation not found" }, { status: 404 });
    }

    return json({
      id: conversation.id,
      title: conversation.title,
      incognito: conversation.incognito,
      status: conversation.status,
      // Pagination envelope. `hasMore` refers to rows ABOVE this page —
      // the thread only ever pages backwards.
      hasMore: conversation.hasMore,
      nextCursor: conversation.nextCursor,
      ConversationHistory: (conversation.ConversationHistory ?? []).map((h) => ({
        id: h.id,
        userType: h.userType,
        role:
          (h as any).role ?? (h.userType === "Agent" ? "assistant" : "user"),
        parts: h.parts ?? [{ type: "text", text: h.message }],
        message: h.message,
        createdAt: h.createdAt,
        // Included so the client's per-message sender attribution +
        // working-state placeholder rendering (via useConversationLive)
        // work on refetch, not just from the initial loader snapshot.
        agentId: (h as { agentId?: string | null }).agentId ?? null,
        status: (h as { status?: string | null }).status ?? null,
      })),
    });
  },
);

export { loader };
