import neo4j from "neo4j-driver";
import { driver } from "~/lib/neo4j.server";
import { logger } from "~/services/logger.service";
import { makeModelCall } from "~/lib/model.server";

// Helper function to safely convert Neo4j integers to JavaScript numbers
function toNumber(value: any): number {
  if (typeof value === "number") {
    return value;
  }
  if (value && typeof value.toNumber === "function") {
    return value.toNumber();
  }
  return Number(value);
}

// ============================================================================
// Type Definitions
// ============================================================================

export interface SpaceDiscoveryParams {
  userId: string;
  spaceIds?: string[];
  minEpisodeCount?: number;
  maxEntities?: number;
  existingSpaces?: Array<{ name: string; description: string | null }>; // Existing spaces to avoid duplicates
}

export interface EntityCluster {
  entity: string;
  entityUuid: string;
  episodeCount: number;
  topSubjects: Array<{ name: string; count: number }>;
  topObjects: Array<{ name: string; count: number }>;
  topPredicates: Array<{ name: string; count: number }>;
  sampleEpisodes: Array<{
    uuid: string;
    content: string;
    subject: string;
    predicate: string;
    object: string;
  }>;
}

export interface SpaceProposal {
  name: string;
  intent: string;
  confidence: number; // 0-100
  sourceEntities: string[]; // Which entities suggested this space
  keyEntities: string[];
  estimatedEpisodeCount: number;
  reasoning: string;
}

export interface SpaceDiscoveryResult {
  clusters: EntityCluster[];
  proposals: SpaceProposal[];
  stats: {
    totalEntities: number;
    totalEpisodes: number;
    clustersAnalyzed: number;
  };
}

// ============================================================================
// Step 1: Entity-Based Clustering
// ============================================================================

/**
 * Analyze entity clusters by grouping episodes by top entities
 * For each entity, find co-occurring subjects, objects, and predicates
 */
async function analyzeEntityClusters(
  userId: string,
  spaceIds: string[] | undefined,
  minEpisodeCount: number,
  maxEntities: number,
): Promise<EntityCluster[]> {
  const session = driver.session();

  try {
    logger.info("Analyzing entity clusters...");

    const spaceFilter = spaceIds?.length
      ? "AND any(sid IN ep.spaceIds WHERE sid IN $spaceIds)"
      : "";

    // Query: Get top entities (subjects + objects) with their episode context
    const query = `
      // Get entities that appear as either subject or object
      MATCH (entity:Entity {userId: $userId})
      MATCH (entity)<-[r:HAS_SUBJECT|HAS_OBJECT]-(stmt:Statement {userId: $userId})
            <-[:HAS_PROVENANCE]-(ep:Episode {userId: $userId})
      WHERE 1=1 ${spaceFilter}

      WITH entity, count(DISTINCT ep) as episodeCount
      WHERE episodeCount >= $minEpisodeCount

      // For top entities, get their context (subjects, objects, predicates, sample episodes)
      MATCH (entity)<-[r:HAS_SUBJECT|HAS_OBJECT]-(stmt:Statement {userId: $userId})
            <-[:HAS_PROVENANCE]-(ep:Episode {userId: $userId})
      WHERE 1=1 ${spaceFilter}

      MATCH (stmt)-[:HAS_SUBJECT]->(subj:Entity {userId: $userId})
      MATCH (stmt)-[:HAS_OBJECT]->(obj:Entity {userId: $userId})
      MATCH (stmt)-[:HAS_PREDICATE]->(pred:Entity {userId: $userId})

      WITH entity,
           episodeCount,
           collect(DISTINCT subj.name) as subjects,
           collect(DISTINCT obj.name) as objects,
           collect(DISTINCT pred.name) as predicates,
           collect(DISTINCT {
             uuid: ep.uuid,
             content: ep.content,
             subject: subj.name,
             predicate: pred.name,
             object: obj.name
           })[0..8] as sampleEpisodes

      RETURN
        entity.name as entityName,
        entity.uuid as entityUuid,
        episodeCount,
        subjects,
        objects,
        predicates,
        sampleEpisodes
      ORDER BY episodeCount DESC
      LIMIT $maxEntities
    `;

    const result = await session.run(query, {
      userId,
      spaceIds: spaceIds || [],
      minEpisodeCount: neo4j.int(minEpisodeCount),
      maxEntities: neo4j.int(maxEntities),
    });

    const clusters: EntityCluster[] = result.records.map((record) => {
      const subjects = record.get("subjects") as string[];
      const objects = record.get("objects") as string[];
      const predicates = record.get("predicates") as string[];
      const sampleEpisodes = record.get("sampleEpisodes") as Array<any>;

      return {
        entity: record.get("entityName"),
        entityUuid: record.get("entityUuid"),
        episodeCount: toNumber(record.get("episodeCount")),
        topSubjects: countFrequency(subjects).slice(0, 10),
        topObjects: countFrequency(objects).slice(0, 10),
        topPredicates: countFrequency(predicates).slice(0, 10),
        sampleEpisodes: sampleEpisodes.map((ep) => ({
          uuid: ep.uuid,
          content: ep.content || "",
          subject: ep.subject || "",
          predicate: ep.predicate || "",
          object: ep.object || "",
        })),
      };
    });

    logger.info(`Found ${clusters.length} entity clusters`);
    return clusters;
  } finally {
    await session.close();
  }
}

/**
 * Count frequency of items in array and return sorted by count
 */
function countFrequency(
  items: string[],
): Array<{ name: string; count: number }> {
  const counts = new Map<string, number>();
  items.forEach((item) => {
    counts.set(item, (counts.get(item) || 0) + 1);
  });

  return Array.from(counts.entries())
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);
}

// ============================================================================
// Step 2: Group Similar Entity Clusters
// ============================================================================

/**
 * Group entity clusters by similarity (co-occurring entities and predicates)
 * This helps merge related entities into thematic groups
 */
function groupSimilarClusters(clusters: EntityCluster[]): EntityCluster[][] {
  // For now, return each cluster as its own group
  // Future enhancement: use entity/predicate overlap to merge similar clusters
  return clusters.map((cluster) => [cluster]);
}

// ============================================================================
// Step 3: LLM Synthesis for Space Proposals
// ============================================================================

/**
 * Generate space proposals from entity clusters using LLM
 */
async function generateSpaceProposalsFromClusters(
  clusterGroups: EntityCluster[][],
  userId: string,
  existingSpaces?: Array<{ name: string; description: string | null }>,
): Promise<SpaceProposal[]> {
  logger.info("Generating space proposals from entity clusters...");

  // Flatten for prompt (treat each cluster separately for now)
  const clusters = clusterGroups.flat();

  const prompt = buildSpaceDiscoveryPrompt(clusters, existingSpaces);

  let proposals: SpaceProposal[] = [];

  await makeModelCall(
    false, // not streaming
    [
      {
        role: "user",
        content: prompt,
      },
    ],
    (text) => {
      try {
        const parsed = JSON.parse(text);
        proposals = (parsed.spaces || []).map((space: any) => ({
          ...space,
          sourceEntities: space.sourceEntities || [],
          keyEntities: space.keyEntities || [],
          estimatedEpisodeCount: space.estimatedEpisodeCount || 0,
        }));
      } catch (error) {
        logger.error(`Failed to parse LLM response: ${error}`);
        logger.error(`Response text: ${text}`);
      }
    },
    {
      temperature: 0.7,
      response_format: { type: "json_object" },
    },
    "high", // Use high complexity for better analysis
  );

  logger.info(`Generated ${proposals.length} space proposals`);
  return proposals;
}

/**
 * Build LLM prompt for space discovery from entity clusters
 */
function buildSpaceDiscoveryPrompt(
  clusters: EntityCluster[],
  existingSpaces?: Array<{ name: string; description: string | null }>,
): string {
  const clusterDescriptions = clusters
    .map((cluster, idx) => {
      // Format top subjects, objects, and predicates
      const topSubjects = cluster.topSubjects
        .slice(0, 6)
        .map((s) => `"${s.name}" (${s.count})`)
        .join(", ");

      const topObjects = cluster.topObjects
        .slice(0, 6)
        .map((o) => `"${o.name}" (${o.count})`)
        .join(", ");

      const topPredicates = cluster.topPredicates
        .slice(0, 6)
        .map((p) => `"${p.name}" (${p.count})`)
        .join(", ");

      // Format sample episodes (truncate to 200 chars each)
      const episodeTexts = cluster.sampleEpisodes
        .slice(0, 4)
        .map(
          (ep, epIdx) =>
            `    ${epIdx + 1}. [${ep.subject} → ${ep.predicate} → ${ep.object}]\n       "${ep.content.substring(0, 200)}${ep.content.length > 200 ? "..." : ""}"`,
        )
        .join("\n");

      return `
### Entity ${idx + 1}: "${cluster.entity}"
- **Episodes**: ${cluster.episodeCount}
- **Top Subjects**: ${topSubjects}
- **Top Objects**: ${topObjects}
- **Top Predicates**: ${topPredicates}

**Sample Episodes**:
${episodeTexts}
`;
    })
    .join("\n");

  // Format existing spaces if provided
  const existingSpacesSection =
    existingSpaces && existingSpaces.length > 0
      ? `
## Existing Spaces (DO NOT DUPLICATE)

The user already has the following spaces. DO NOT propose spaces with similar names or intents:

${existingSpaces
  .map(
    (space, idx) =>
      `${idx + 1}. **"${space.name}"**${space.description ? `: ${space.description}` : ""}`,
  )
  .join("\n")}

IMPORTANT: Avoid proposing spaces that overlap with these existing ones. Focus on discovering NEW themes.
`
      : "";

  return `You are analyzing entity clusters from a knowledge graph to discover thematic spaces for organizing episodes.

Each **Entity Cluster** represents a prominent topic/concept with its associated episodes and related entities.
A **Space** is a thematic container that groups related episodes based on projects, topics, or domains.
${existingSpacesSection}
## Entity Clusters

${clusterDescriptions}

## Your Task

Analyze these entity clusters to identify 3-10 major THEMES that would make meaningful organizational spaces.

## Guidelines

1. **Look for related entities**: Group clusters that share common subjects/objects/predicates
   - Example: "Core", "Backend", "Frontend" with "part_of", "uses" → "Core Project Development"
   - Example: "Department-Specific Index", "Permission", "Configuration" → "Department Indexing Feature"

2. **Identify project/feature themes**: Technical content often organizes by:
   - Projects/codebases (e.g., "Core", "Apollo")
   - Features/capabilities (e.g., "Department Indexing", "API Development")
   - Components/layers (e.g., "Frontend", "Backend", "Database")
   - Cross-cutting concerns (e.g., "Security", "Performance")

3. **Consider entity relationships**:
   - Entities with overlapping subjects/objects likely belong together
   - Common predicates suggest similar types of content
   - Check sample episodes for thematic coherence

4. **Space naming**:
   - Use natural, descriptive names (2-6 words)
   - Should reflect how user would search/think about content
   - Prefer specific over generic (e.g., "Core Backend" > "Backend Code")

5. **Confidence scoring**:
   - 90-100: Very clear theme, strong entity clustering, coherent episodes
   - 75-89: Clear theme, good evidence from entities and episodes
   - 60-74: Moderate theme, reasonable grouping but some diversity
   - Below 60: Don't propose

## Output Format

Return ONLY valid JSON (no markdown, no explanation):

{
  "spaces": [
    {
      "name": "Core Project Development",
      "intent": "All discussions, code, and documentation related to the Core project including backend, frontend, and configuration",
      "confidence": 92,
      "sourceEntities": ["Core", "Backend", "Frontend"],
      "keyEntities": ["Core", "Backend", "Frontend", "Configuration", "API"],
      "estimatedEpisodeCount": 350,
      "reasoning": "Strong clustering around Core entity with clear project scope. Multiple related components and consistent technical predicates."
    },
    {
      "name": "Department Indexing & Permissions",
      "intent": "Feature development for department-specific indexes, permission filtering, and access control",
      "confidence": 85,
      "sourceEntities": ["Department-Specific Index", "Permission Filtering", "Index"],
      "keyEntities": ["Department-Specific Index", "Permission", "Backend", "Index", "Filtering"],
      "estimatedEpisodeCount": 280,
      "reasoning": "Clear feature theme with related permission and indexing concepts. Coherent technical discussions."
    }
  ]
}

Important:
- Propose 3-10 spaces maximum
- Each space must have confidence >= 60
- Avoid overlapping spaces - ensure distinct themes
- sourceEntities: List of main entity clusters this space is built from
- keyEntities: All important entities that belong in this space
- estimatedEpisodeCount: Sum episode counts from relevant entity clusters
- Reasoning: Explain WHY these entities form a coherent theme`;
}

// ============================================================================
// Main Discovery Function
// ============================================================================

/**
 * Discover thematic spaces using entity-first analysis
 *
 * Process:
 * 1. Analyze entity clusters (group episodes by top entities)
 * 2. Group similar clusters by entity/predicate overlap
 * 3. Use LLM to synthesize clusters into thematic spaces
 */
export async function discoverThematicSpaces(
  params: SpaceDiscoveryParams,
): Promise<SpaceDiscoveryResult> {
  const {
    userId,
    spaceIds,
    minEpisodeCount = 30,
    maxEntities = 50,
    existingSpaces,
  } = params;

  const session = driver.session();

  try {
    logger.info(`Starting space discovery for user ${userId}`);

    // Step 1: Analyze entity clusters
    const clusters = await analyzeEntityClusters(
      userId,
      spaceIds,
      minEpisodeCount,
      maxEntities,
    );

    if (clusters.length === 0) {
      logger.info("No entity clusters found");
      return {
        clusters: [],
        proposals: [],
        stats: {
          totalEntities: 0,
          totalEpisodes: 0,
          clustersAnalyzed: 0,
        },
      };
    }

    // Step 2: Group similar clusters (future enhancement)
    const clusterGroups = groupSimilarClusters(clusters);

    // Step 3: Generate space proposals via LLM (with existing spaces to avoid duplicates)
    const proposals = await generateSpaceProposalsFromClusters(
      clusterGroups,
      userId,
      existingSpaces,
    );

    // Get overall stats
    const statsQuery = `
      MATCH (entity:Entity {userId: $userId})<-[:HAS_SUBJECT|HAS_OBJECT]-(:Statement {userId: $userId})<-[:HAS_PROVENANCE]-(ep:Episode {userId: $userId})
      RETURN count(DISTINCT entity) as totalEntities, count(DISTINCT ep) as totalEpisodes
    `;

    const statsResult = await session.run(statsQuery, { userId });

    const result: SpaceDiscoveryResult = {
      clusters,
      proposals,
      stats: {
        totalEntities:
          toNumber(statsResult.records[0]?.get("totalEntities")) || 0,
        totalEpisodes:
          toNumber(statsResult.records[0]?.get("totalEpisodes")) || 0,
        clustersAnalyzed: clusters.length,
      },
    };

    // Print summary
    printSpaceDiscoverySummary(result);

    return result;
  } catch (error) {
    logger.error(`Error in space discovery: ${error}`);
    throw error;
  } finally {
    await session.close();
  }
}

// ============================================================================
// Utilities
// ============================================================================

/**
 * Print formatted summary of space discovery results
 */
function printSpaceDiscoverySummary(result: SpaceDiscoveryResult): void {
  console.log("\n" + "=".repeat(80));
  console.log("THEMATIC SPACE DISCOVERY (Entity-First)");
  console.log("=".repeat(80));

  console.log("\nOVERALL STATISTICS:");
  console.log(`  Total Entities: ${result.stats.totalEntities}`);
  console.log(`  Total Episodes: ${result.stats.totalEpisodes}`);
  console.log(`  Entity Clusters Analyzed: ${result.stats.clustersAnalyzed}`);
  console.log(`  Space Proposals: ${result.proposals.length}`);

  if (result.clusters.length > 0) {
    console.log("\n" + "-".repeat(80));
    console.log("\nTOP ENTITY CLUSTERS:");
    result.clusters.slice(0, 10).forEach((cluster, idx) => {
      console.log(
        `  ${idx + 1}. "${cluster.entity}" - ${cluster.episodeCount} episodes`,
      );
      console.log(
        `     Top subjects: ${cluster.topSubjects
          .slice(0, 3)
          .map((s) => s.name)
          .join(", ")}`,
      );
      console.log(
        `     Top objects: ${cluster.topObjects
          .slice(0, 3)
          .map((o) => o.name)
          .join(", ")}`,
      );
      console.log(
        `     Top predicates: ${cluster.topPredicates
          .slice(0, 3)
          .map((p) => p.name)
          .join(", ")}`,
      );
    });
  }

  if (result.proposals.length > 0) {
    console.log("\n" + "-".repeat(80));
    console.log("\nSPACE PROPOSALS:");
    result.proposals.forEach((proposal, idx) => {
      console.log(
        `\n  ${idx + 1}. "${proposal.name}" (${proposal.confidence}% confidence)`,
      );
      console.log(`     Intent: ${proposal.intent}`);
      console.log(`     Episodes: ~${proposal.estimatedEpisodeCount}`);
      console.log(
        `     Source entities: ${proposal.sourceEntities.join(", ")}`,
      );
      console.log(
        `     Key entities: ${proposal.keyEntities.slice(0, 5).join(", ")}`,
      );
      console.log(`     Reasoning: ${proposal.reasoning}`);
    });
  }

  console.log("\n" + "=".repeat(80) + "\n");
}
