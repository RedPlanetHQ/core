
import type { RecallResult } from "./types";

/**
 * Format a date for display in recall output
 */
function formatDate(
  date: Date,
  includeTime: boolean = false,
): string {
  const options: Intl.DateTimeFormatOptions = {
    month: "short",
    day: "numeric",
    year: "numeric",
  };
  if (includeTime) {
    options.hour = "2-digit";
    options.minute = "2-digit";
  }
  return date.toLocaleString("en-US", options);
}

/**
 * Format recall result as markdown for LLM consumption
 *
 * Design principles:
 * - Compacts are already markdown — render them inline with minimal wrapper
 * - Strip internal IDs (UUIDs, relevance scores) that add noise for LLMs
 * - Keep date context so the LLM can reason temporally
 * - Use clean markdown hierarchy: ## for sections, ### for items
 */
export function formatRecallAsMarkdown(result: RecallResult): string {
  const sections: string[] = [];

  // Entity section
  if (result.entity) {
    sections.push("## Entity Information\n");
    sections.push(`**${result.entity.name}**`);

    if (result.entity.attributes && Object.keys(result.entity.attributes).length > 0) {
      for (const [key, value] of Object.entries(result.entity.attributes)) {
        sections.push(`- ${key}: ${value}`);
      }
    }
    sections.push("");
  }

  // Statements section
  if (result.statements && result.statements.length > 0) {
    sections.push("## Statements\n");

    result.statements.forEach((stmt) => {
      const date = formatDate(stmt.validAt);
      const aspectTag = stmt.aspect ? `[${stmt.aspect}] ` : "";
      sections.push(`- ${aspectTag}${stmt.fact} _(${date})_`);
    });
    sections.push("");
  }

  // Episodes / compacts / documents section
  if (result.episodes.length > 0) {
    sections.push("## Recalled Relevant Context\n");

    result.episodes.forEach((episode, index) => {
      const date = formatDate(episode.createdAt, true);

      if (episode.isCompact) {
        // Compacts are already well-structured markdown from the LLM.
        // Render with a thin header (date only) and inline the content directly.
        sections.push(`### Session Summary _(${date})_`);
        sections.push("");
        sections.push(episode.content);
        sections.push("");
      } else if (episode.isDocument) {
        sections.push(`### Document ${index + 1} _(${date})_`);
        if (episode.labelIds.length > 0) {
          sections.push(`**Labels**: ${episode.labelIds.join(", ")}`);
        }
        sections.push("");
        sections.push(episode.content);
        sections.push("");
      } else {
        sections.push(`### Episode ${index + 1} _(${date})_`);
        if (episode.labelIds.length > 0) {
          sections.push(`**Labels**: ${episode.labelIds.join(", ")}`);
        }
        sections.push("");
        sections.push(episode.content);
        sections.push("");
      }
    });
  }

  // Invalidated facts
  if (result.invalidatedFacts && result.invalidatedFacts.length > 0) {
    sections.push("## Invalidated Facts\n");

    result.invalidatedFacts.forEach((fact) => {
      const validDate = formatDate(fact.validAt);
      const invalidDate = fact.invalidAt ? formatDate(fact.invalidAt) : "";
      sections.push(`- ~~${fact.fact}~~ _(${validDate} → ${invalidDate})_`);
    });
    sections.push("");
  }

  // Empty results
  if (
    result.episodes.length === 0 &&
    (!result.statements || result.statements.length === 0) &&
    (!result.invalidatedFacts || result.invalidatedFacts.length === 0) &&
    !result.entity
  ) {
    sections.push("*No relevant memories found.*\n");
  }

  return sections.join("\n");
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
  entity?: {
    name: string;
    attributes: Record<string, any>;
    uuid: string;
  } | null;
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

  return {
    episodes,
    invalidatedFacts,
    statements,
    entity,
  };
}

