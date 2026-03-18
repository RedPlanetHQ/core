
import type { RecallResult } from "./types";
import { countTokens, DEFAULT_TOKEN_BUDGET } from "~/services/search/tokenBudget";

/**
 * Format recall result as markdown for LLM consumption
 * Matches the format from search v1 with entity support added
 */
export function formatRecallAsMarkdown(result: RecallResult): string {
  const sections: string[] = [];

  // Facets section (for temporal_facets queries)
  if (result.facets) {
    const { facets } = result;
    const startDate = facets.dateRange.startTime.toLocaleDateString("en-US", {
      month: "short", day: "numeric", year: "numeric",
    });
    const endDate = facets.dateRange.endTime
      ? facets.dateRange.endTime.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
      : "now";
    sections.push(`## Memory Overview (${startDate} – ${endDate})\n`);

    if (facets.topics && facets.topics.length > 0) {
      sections.push("### Topics");
      facets.topics.forEach((t) => {
        sections.push(`- **${t.labelName}** (${t.episodeCount} episode${t.episodeCount !== 1 ? "s" : ""})`);
      });
      sections.push("");
    }

    if (facets.entities && facets.entities.length > 0) {
      sections.push("### People & Entities");
      facets.entities.forEach((e) => {
        sections.push(`- **${e.entityName}** (${e.mentionCount} mention${e.mentionCount !== 1 ? "s" : ""})`);
      });
      sections.push("");
    }

    if (facets.aspects && facets.aspects.length > 0) {
      sections.push("### By Aspect");
      facets.aspects.forEach((a) => {
        const date = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
        sections.push(`\n**${a.aspect}** (${a.statementCount} statement${a.statementCount !== 1 ? "s" : ""})`);
        a.statements.forEach((s) => {
          sections.push(`- ${s.fact} _(${date(s.validAt)})_ \`ep:${s.episodeUuid.slice(0, 8)}\``);
        });
      });
      sections.push("");
    }

    if (facets.compactSessions && facets.compactSessions.length > 0) {
      sections.push("### Conversation Highlights");
      facets.compactSessions.forEach((s) => {
        sections.push(`\n**${s.labelName}**`);
        sections.push(s.content);
      });
      sections.push("");
    }

    if (facets.stats) {
      const { totalEpisodes, newFacts, activeTopics } = facets.stats;
      sections.push(`*${totalEpisodes} conversation${totalEpisodes !== 1 ? "s" : ""} · ${newFacts} new fact${newFacts !== 1 ? "s" : ""} · ${activeTopics} topic${activeTopics !== 1 ? "s" : ""}*\n`);
    }

    if (!facets.topics?.length && !facets.entities?.length && !facets.aspects?.length) {
      sections.push("*No data found in the requested time range.*\n");
    }

    return truncateAtTokenBudget(sections.join("\n"));
  }

  // Add entity section (if present, typically for entity_lookup queries)
  if (result.entity) {
    sections.push("## Entity Information\n");
    sections.push(`**Name**: ${result.entity.name}`);
    sections.push(`**UUID**: ${result.entity.uuid}`);

    if (result.entity.attributes && Object.keys(result.entity.attributes).length > 0) {
      sections.push("\n**Attributes**:");
      for (const [key, value] of Object.entries(result.entity.attributes)) {
        sections.push(`- ${key}: ${value}`);
      }
    }
    sections.push(""); // Empty line
  }

  // Add voice aspects section (user's voice: directives, preferences, habits, beliefs, goals)
  if (result.voiceAspects && result.voiceAspects.length > 0) {
    sections.push("## Voice Aspects\n");

    result.voiceAspects.forEach((va) => {
      sections.push(`- [${va.aspect}] ${va.fact}`);
    });
    sections.push(""); // Empty line
  }

  // Add statements section (for entity_lookup, relationship queries)
  if (result.statements && result.statements.length > 0) {
    sections.push("## Statements\n");

    result.statements.forEach((stmt) => {
      const date = stmt.validAt.toLocaleString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      });

      const aspectTag = stmt.aspect ? `[${stmt.aspect}] ` : "";
      sections.push(`- ${aspectTag}${stmt.fact} _(${date})_`);
    });
    sections.push(""); // Empty line
  }

  // Add episodes/compacts section
  if (result.episodes.length > 0) {
    sections.push("## Recalled Relevant Context\n");

    result.episodes.forEach((episode, index) => {
      const date = episode.createdAt.toLocaleString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });

      if (episode.isCompact) {
        sections.push(`### 📦 Session Compact`);
        sections.push(`**UUID**: ${episode.uuid}`);
        sections.push(`**Created**: ${date}`);
        if (episode.relevanceScore !== undefined) {
          sections.push(`**Relevance**: ${episode.relevanceScore.toFixed(3)}`);
        }
        sections.push(""); // Empty line before content
        sections.push(episode.content);
        sections.push(""); // Empty line
      } else if (episode.isDocument) {
        sections.push(`### 📄 Document ${index + 1}`);
        sections.push(`**UUID**: ${episode.uuid}`);
        sections.push(`**Created**: ${date}`);
        if (episode.relevanceScore !== undefined) {
          sections.push(`**Relevance**: ${episode.relevanceScore.toFixed(3)}`);
        }
        if (episode.labelIds.length > 0) {
          sections.push(`**Labels**: ${episode.labelIds.join(", ")}`);
        }
        sections.push(""); // Empty line before content
        sections.push(episode.content);
        sections.push(""); // Empty line after
      } else {
        sections.push(`### Episode ${index + 1}`);
        sections.push(`**UUID**: ${episode.uuid}`);
        sections.push(`**Created**: ${date}`);
        if (episode.relevanceScore !== undefined) {
          sections.push(`**Relevance**: ${episode.relevanceScore.toFixed(3)}`);
        }
        if (episode.labelIds.length > 0) {
          sections.push(`**Labels**: ${episode.labelIds.join(", ")}`);
        }
        sections.push(""); // Empty line before content
        sections.push(episode.content);
        sections.push(""); // Empty line after
      }
    });
  }

  // Add invalidated facts section (only showing facts that are no longer valid)
  if (result.invalidatedFacts && result.invalidatedFacts.length > 0) {
    sections.push("## Invalidated Facts\n");

    result.invalidatedFacts.forEach((fact) => {
      const validDate = fact.validAt.toLocaleString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      });
      const invalidDate = fact.invalidAt
        ? fact.invalidAt.toLocaleString("en-US", {
            month: "short",
            day: "numeric",
            year: "numeric",
          })
        : "";

      sections.push(`- ${fact.fact}`);
      sections.push(`  *Valid: ${validDate} → Invalidated: ${invalidDate}*`);
    });
    sections.push(""); // Empty line after facts
  }

  // Handle empty results
  if (
    result.episodes.length === 0 &&
    (!result.statements || result.statements.length === 0) &&
    (!result.voiceAspects || result.voiceAspects.length === 0) &&
    (!result.invalidatedFacts || result.invalidatedFacts.length === 0) &&
    !result.entity
  ) {
    sections.push("*No relevant memories found.*\n");
  }

  return truncateAtTokenBudget(sections.join("\n"));
}

/**
 * Truncate text to fit within DEFAULT_TOKEN_BUDGET.
 * Splits on newlines to avoid cutting mid-line.
 * Appends a warning at the bottom if truncated.
 */
function truncateAtTokenBudget(text: string): string {
  if (countTokens(text) <= DEFAULT_TOKEN_BUDGET) return text;

  const lines = text.split("\n");
  const kept: string[] = [];
  let tokens = 0;

  for (const line of lines) {
    const lineTokens = countTokens(line + "\n");
    if (tokens + lineTokens > DEFAULT_TOKEN_BUDGET) break;
    kept.push(line);
    tokens += lineTokens;
  }

  kept.push(
    "\n---",
    "> **There is more data in this time range that was not shown.** Reduce the date range (e.g. last 3 days instead of last week) to see complete results."
  );

  return kept.join("\n");
}

/**
 * Format recall result to match v1 API structure (backward compatible)
 * Returns the result in the same structure as search v1
 */
export function formatForV1Compatibility(result: RecallResult): {
  episodes: Array<{
    uuid: string;
    content: string;
    createdAt: Date;
    labelIds: string[];
    isCompact?: boolean;
    isDocument?: boolean;
    relevanceScore?: number;
  }>;
  invalidatedFacts: Array<{
    fact: string;
    validAt: Date;
    invalidAt: Date | null;
    relevantScore: number;
  }>;
  statements?: Array<{
    fact: string;
    validAt: Date;
    attributes: Record<string, string>;
    aspect: string | null;
  }>;
  voiceAspects?: Array<{
    uuid: string;
    fact: string;
    aspect: string;
    score?: number;
  }>;
  entity?: {
    name: string;
    attributes: Record<string, any>;
    uuid: string;
  } | null;
  facets?: RecallResult["facets"];
  warning?: string;
} {
  // Map episodes (already in correct format)
  const episodes = result.episodes.map((ep) => ({
    uuid: ep.uuid,
    content: ep.content,
    createdAt: ep.createdAt,
    labelIds: ep.labelIds,
    isCompact: ep.isCompact,
    isDocument: ep.isDocument,
    relevanceScore: ep.relevanceScore,
  }));

  // Map invalidated facts (or empty array if not present)
  const invalidatedFacts = (result.invalidatedFacts || []).map((fact) => ({
    fact: fact.fact,
    validAt: fact.validAt,
    invalidAt: fact.invalidAt,
    relevantScore: fact.relevantScore,
  }));

  // Map statements if present
  const statements = result.statements?.map((stmt) => ({
    fact: stmt.fact,
    validAt: stmt.validAt,
    attributes: stmt.attributes,
    aspect: stmt.aspect,
  }));

  // Map entity if present
  const entity = result.entity
    ? {
        name: result.entity.name,
        attributes: result.entity.attributes,
        uuid: result.entity.uuid,
      }
    : null;

  // Map voice aspects if present
  const voiceAspects = result.voiceAspects?.map((va) => ({
    uuid: va.uuid,
    fact: va.fact,
    aspect: va.aspect,
    score: va.score,
  }));

  return {
    episodes,
    invalidatedFacts,
    statements,
    voiceAspects,
    entity,
    facets: result.facets,
    warning: result.warning,
  };
}

