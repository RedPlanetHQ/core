/**
 * Summary Tools for Core Agent
 *
 * Provides get_memory_summary tool for generating memory summaries
 * over a given time period. Used both on-demand and via weekly reminders.
 */

import { tool, type Tool } from "ai";
import { z } from "zod";
import { ProviderFactory } from "@core/providers";
import { prisma } from "~/db.server";
import { logger } from "~/services/logger.service";

const MAX_COMPACT_LENGTH = 2000;
const TOP_LABELS_COUNT = 10;

/**
 * Get memory summary tools for the core agent
 */
export function getSummaryTools(
  workspaceId: string,
  userId: string,
): Record<string, Tool> {
  return {
    get_memory_summary: tool({
      description: `Retrieve a structured summary of what CORE learned about the user over a time period.
Returns topics discussed, entities mentioned, new facts learned, and compact session summaries.
Use when user asks "what did you learn about me", "weekly summary", "summarize last N days", etc.`,
      inputSchema: z.object({
        days_back: z
          .number()
          .optional()
          .describe(
            "Number of days to look back. Defaults to 7 (one week).",
          ),
      }),
      execute: async ({ days_back = 7 }) => {
        try {
          const now = new Date();
          const startTime = new Date(
            now.getTime() - days_back * 24 * 60 * 60 * 1000,
          );

          logger.info(
            `get_memory_summary: fetching ${days_back}-day summary for workspace ${workspaceId}, range: ${startTime.toISOString()} to ${now.toISOString()}`,
          );

          const graphProvider = ProviderFactory.getGraphProvider();

          const endTime = now;

          // Fetch all three facets in parallel
          const [topicsRaw, entitiesRaw, aspectsRaw] = await Promise.all([
            graphProvider.getTopicsForFacets({
              userId,
              workspaceId,
              startTime,
              endTime,
            }),
            graphProvider.getEntitiesForFacets({
              userId,
              workspaceId,
              startTime,
              endTime,
            }),
            graphProvider.getAspectsForFacets({
              userId,
              workspaceId,
              startTime,
              endTime,
            }),
          ]);

          // Resolve topic labelIds to label names
          const labelIds = topicsRaw.map((t) => t.labelId);
          const labels = labelIds.length > 0
            ? await prisma.label.findMany({
                where: { id: { in: labelIds } },
                select: { id: true, name: true },
              })
            : [];
          const labelMap = new Map(labels.map((l) => [l.id, l.name]));

          const topics = topicsRaw
            .map((t) => ({
              label: labelMap.get(t.labelId) ?? t.labelId,
              episodeCount: t.episodeCount,
            }))
            .sort((a, b) => b.episodeCount - a.episodeCount);

          const entities = entitiesRaw
            .map((e) => ({
              name: e.entityName,
              mentions: e.mentionCount,
            }))
            .sort((a, b) => b.mentions - a.mentions);

          const newFacts = aspectsRaw.map((a) => ({
            aspect: a.aspect,
            count: a.statementCount,
            facts: a.statements.map((s) => s.fact),
          }));

          // Fetch compact sessions for top labels
          const topLabelIds = topicsRaw
            .sort((a, b) => b.episodeCount - a.episodeCount)
            .slice(0, TOP_LABELS_COUNT)
            .map((t) => t.labelId);

          let compactSessions: { label: string; summary: string }[] = [];
          if (topLabelIds.length > 0) {
            const documents = await prisma.document.findMany({
              where: {
                workspaceId,
                type: "conversation",
                deleted: null,
                updatedAt: { gte: startTime },
                labelIds: { hasSome: topLabelIds },
              },
              select: {
                labelIds: true,
                content: true,
                updatedAt: true,
              },
              orderBy: { updatedAt: "desc" },
            });

            // Group by label, take latest per label
            const latestByLabel = new Map<
              string,
              { content: string; updatedAt: Date }
            >();
            for (const doc of documents) {
              for (const lid of doc.labelIds) {
                if (
                  topLabelIds.includes(lid) &&
                  !latestByLabel.has(lid)
                ) {
                  latestByLabel.set(lid, {
                    content: doc.content ?? "",
                    updatedAt: doc.updatedAt,
                  });
                }
              }
            }

            compactSessions = Array.from(latestByLabel.entries()).map(
              ([lid, data]) => ({
                label: labelMap.get(lid) ?? lid,
                summary:
                  data.content.length > MAX_COMPACT_LENGTH
                    ? data.content.slice(0, MAX_COMPACT_LENGTH) + "…"
                    : data.content,
              }),
            );
          }

          // Compute stats
          const totalEpisodes = topicsRaw.reduce(
            (sum, t) => sum + t.episodeCount,
            0,
          );
          const totalNewFacts = aspectsRaw.reduce(
            (sum, a) => sum + a.statementCount,
            0,
          );

          // Format period string
          const periodStart = startTime.toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
          });
          const periodEnd = now.toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
            year: "numeric",
          });

          const result = {
            period: `${periodStart} – ${periodEnd}`,
            topics,
            entities,
            newFacts,
            compactSessions,
            stats: {
              totalEpisodes,
              newFacts: totalNewFacts,
              activeTopics: topics.length,
            },
          };

          logger.info(
            `get_memory_summary: ${topics.length} topics, ${entities.length} entities, ${totalNewFacts} facts`,
          );

          return JSON.stringify(result);
        } catch (error) {
          logger.error("get_memory_summary failed", { error });
          return JSON.stringify({
            error: "Failed to generate memory summary. Please try again.",
          });
        }
      },
    }),
  };
}
