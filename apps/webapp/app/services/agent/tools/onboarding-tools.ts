/**
 * Onboarding-flow tools for the main agent.
 *
 * - suggest_integrations (global): renders inline integration connect
 *   cards in the chat. The UI catches the tool call, looks up each
 *   slug's OAuth URL client-side, and renders a Connect button per
 *   card. Can be used anytime — onboarding flow, or later when the
 *   agent notices the user could benefit from connecting something.
 *
 * - complete_onboarding (onboarding-only): flips
 *   user.onboardingComplete = true and optionally stores the final
 *   profile summary into user.metadata.onboardingSummary. Other
 *   metadata fields (timezone, personality, etc.) are preserved.
 */

import { tool, type Tool } from "ai";
import { z } from "zod";
import { prisma } from "~/db.server";
import { logger } from "~/services/logger.service";

export function getSuggestIntegrationsTool(): Tool {
  return tool({
    description:
      "Render inline integration connect cards in the chat. Pick 1-3 integrations grounded in what you actually know about the user — never a generic list. Each card has a one-line reason. The UI handles OAuth on click. Skip if there's no clear reason to suggest.",
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
        .max(3)
        .describe(
          "1-3 integration suggestions, ordered by relevance. The most compelling pick first.",
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
        select: { id: true, slug: true, name: true, icon: true },
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
