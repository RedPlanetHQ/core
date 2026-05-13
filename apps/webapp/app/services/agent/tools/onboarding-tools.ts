/**
 * Integration + onboarding tools for the main agent. All three are
 * registered globally — the agent's prompt and each tool's description
 * tell it when calling makes sense. complete_onboarding is idempotent
 * (no-ops if onboarding is already complete) so there's no need to
 * conditionally register it.
 *
 * - list_available_integrations: returns the catalog of integration
 *   definitions the workspace can connect, with isConnected flags. The
 *   agent calls this before suggest_integrations to know which slugs
 *   are valid and to avoid suggesting things already connected.
 *
 * - suggest_integrations: renders inline integration connect cards in
 *   the chat. The UI catches the tool call, looks up each slug's OAuth
 *   URL client-side, and renders a Connect button per card.
 *
 * - complete_onboarding: flips user.onboardingComplete = true and
 *   stores the final profile summary into user.metadata.onboardingSummary.
 *   Other metadata fields (timezone, personality, etc.) are preserved.
 *   Short-circuits with {already_complete: true} on re-calls.
 */

import { tool, type Tool } from "ai";
import { z } from "zod";
import { prisma } from "~/db.server";
import { logger } from "~/services/logger.service";

export function getListAvailableIntegrationsTool(
  userId: string,
  workspaceId: string,
): Tool {
  return tool({
    description:
      "Get the catalog of integrations the user's workspace can connect. Returns slug, name, description, and whether the user already has it connected. Call this before suggest_integrations whenever you need to verify which slugs are valid or to avoid recommending something already wired up. Pass an optional query string to filter by slug or name (case-insensitive substring).",
    inputSchema: z.object({
      query: z
        .string()
        .optional()
        .describe(
          "Optional filter — case-insensitive substring matched against slug and name. Omit to get the full catalog.",
        ),
    }),
    execute: async ({ query }: { query?: string }) => {
      const [defs, accounts] = await Promise.all([
        prisma.integrationDefinitionV2.findMany({
          where: {
            deleted: null,
            OR: [{ workspaceId: null }, { workspaceId }],
          },
          select: {
            id: true,
            slug: true,
            name: true,
            description: true,
          },
          orderBy: { name: "asc" },
        }),
        prisma.integrationAccount.findMany({
          where: { integratedById: userId, workspaceId, isActive: true },
          select: { integrationDefinitionId: true },
        }),
      ]);

      const connectedDefIds = new Set(
        accounts.map((a) => a.integrationDefinitionId),
      );

      const lowerQuery = query?.trim().toLowerCase();
      const filtered = lowerQuery
        ? defs.filter(
            (d) =>
              d.slug.toLowerCase().includes(lowerQuery) ||
              d.name.toLowerCase().includes(lowerQuery),
          )
        : defs;

      const integrations = filtered.map((d) => ({
        slug: d.slug,
        name: d.name,
        description: d.description,
        isConnected: connectedDefIds.has(d.id),
      }));

      logger.info(
        `list_available_integrations: ${integrations.length} match${query ? ` (query="${query}")` : ""}`,
      );

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              integrations,
              count: integrations.length,
            }),
          },
        ],
      };
    },
  } as any);
}

export function getSuggestIntegrationsTool(): Tool {
  return tool({
    description:
      "Render inline integration connect cards in the chat. Pick 1-5 integrations grounded in what you actually know about the user — never a generic list. Each card has a one-line reason. The UI handles OAuth on click. Skip if there's no clear reason to suggest.",
    inputSchema: z.object({
      message: z
        .string()
        .optional()
        .describe(
          "Optional short lead-in sentence shown above the cards. Keep it to one sentence. Skip if your assistant message already framed the suggestion.",
        ),
      picks: z
        .array(
          z.object({
            slug: z
              .string()
              .describe(
                "Integration slug (e.g. 'linear', 'github', 'slack', 'notion'). Must match an existing integration definition.",
              ),
            reason: z
              .string()
              .describe(
                "One short sentence explaining why THIS user should connect THIS integration. Grounded in something specific you saw — never generic. Bad: 'connect Linear to manage tickets'. Good: 'you mention the q4 roadmap a lot — connect Linear and I'll pull those tickets in'.",
              ),
          }),
        )
        .min(1)
        .max(5)
        .describe(
          "1-5 integration suggestions, ordered by relevance. The most compelling pick first.",
        ),
    }),
    execute: async ({
      message,
      picks,
    }: {
      message?: string;
      picks: { slug: string; reason: string }[];
    }) => {
      logger.info(
        `suggest_integrations: ${picks.map((p) => p.slug).join(", ")}`,
      );

      const definitions = await prisma.integrationDefinitionV2.findMany({
        where: { slug: { in: picks.map((p) => p.slug) } },
        select: {
          id: true,
          slug: true,
          name: true,
          icon: true,
          // spec is the JSON blob the connect modal inspects to pick
          // between ApiKeyAuthSection / OAuthAuthSection / McpOAuthAuthSection.
          spec: true,
        },
      });

      const bySlug = new Map(definitions.map((d) => [d.slug, d]));

      // Preserve the agent's pick order. Drop unknown slugs but tell the
      // agent so it can retry with valid ones instead of stalling.
      const cards: {
        slug: string;
        name: string;
        icon: string | null;
        definitionId: string;
        reason: string;
        // Raw spec for the connect modal to pick the right auth UI.
        spec: unknown;
      }[] = [];
      const unknown: string[] = [];
      for (const pick of picks) {
        const def = bySlug.get(pick.slug);
        if (!def) {
          unknown.push(pick.slug);
          continue;
        }
        cards.push({
          slug: def.slug,
          name: def.name,
          icon: def.icon,
          definitionId: def.id,
          reason: pick.reason,
          spec: def.spec,
        });
      }

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              message: message ?? null,
              cards,
              unknown,
            }),
          },
        ],
      };
    },
  } as any);
}

export function getCompleteOnboardingTool(userId: string): Tool {
  return tool({
    description:
      "Mark this user's onboarding as complete. Call this once after you've delivered the email profile, suggested integrations, and the user has signaled they're satisfied. After this fires, the conversation continues normally — same thread, no transition. Do NOT call before posting the profile summary. Do NOT call twice.",
    inputSchema: z.object({
      summary: z
        .string()
        .describe(
          "The final markdown profile you posted to the user. Stored as user.metadata.onboardingSummary so future conversations carry the context. Keep it identical to what the user just saw — don't rewrite.",
        ),
    }),
    execute: async ({ summary }: { summary: string }) => {
      logger.info(`complete_onboarding: marking userId=${userId} complete`);

      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { metadata: true, onboardingComplete: true },
      });

      if (!user) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ error: "user not found" }),
            },
          ],
        };
      }

      if (user.onboardingComplete) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                already_complete: true,
                note: "onboarding was already complete — no change",
              }),
            },
          ],
        };
      }

      const existingMetadata =
        (user.metadata as Record<string, unknown> | null) ?? {};

      await prisma.user.update({
        where: { id: userId },
        data: {
          onboardingComplete: true,
          metadata: {
            ...existingMetadata,
            onboardingSummary: summary,
          },
        },
      });

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ completed: true }),
          },
        ],
      };
    },
  } as any);
}
