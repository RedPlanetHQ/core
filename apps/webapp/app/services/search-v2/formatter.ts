
import type { RecallResult } from "./types";

/**
 * Format recall result as markdown for LLM consumption
 * Matches the format from search v1 with entity support added
 */
export function formatRecallAsMarkdown(result: RecallResult): string {
  const sections: string[] = [];

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

