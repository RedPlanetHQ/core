/**
 * Neo4jGraphProvider - Main provider class
 * Orchestrates all domain methods using composition pattern
 */

import { Neo4jCore } from "./core";
import { createEntityMethods } from "./domains/entity";
import { createEpisodeMethods } from "./domains/episode";
import { createStatementMethods } from "./domains/statement";
import { createTripleMethods } from "./domains/triple";
import { createCompactedSessionMethods } from "./domains/compactedSession";
import { createSearchMethods } from "./domains/search";
import { createUserMethods } from "./domains/user";
import type { IGraphProvider } from "../interface";
import type { Neo4jConfig } from "./types";

export class Neo4jGraphProvider extends Neo4jCore implements IGraphProvider {
  // These will be populated by Object.assign in constructor
  getCurrentTimestamp!: () => Promise<Date>;
  saveEntity!: IGraphProvider["saveEntity"];
  getEntity!: IGraphProvider["getEntity"];
  getEntities!: IGraphProvider["getEntities"];
  findSimilarEntities!: IGraphProvider["findSimilarEntities"];
  findExactPredicateMatches!: IGraphProvider["findExactPredicateMatches"];
  findExactEntityMatch!: IGraphProvider["findExactEntityMatch"];
  mergeEntities!: IGraphProvider["mergeEntities"];
  deduplicateEntitiesByName!: IGraphProvider["deduplicateEntitiesByName"];
  deleteOrphanedEntities!: IGraphProvider["deleteOrphanedEntities"];
  getOnboardingEntities!: IGraphProvider["getOnboardingEntities"];

  saveEpisode!: IGraphProvider["saveEpisode"];
  getEpisode!: IGraphProvider["getEpisode"];
  getEpisodes!: IGraphProvider["getEpisodes"];
  getEpisodesByUser!: IGraphProvider["getEpisodesByUser"];
  getEpisodeCountByUser!: IGraphProvider["getEpisodeCountByUser"];
  getRecentEpisodes!: IGraphProvider["getRecentEpisodes"];
  getEpisodesBySession!: IGraphProvider["getEpisodesBySession"];
  deleteEpisodeWithRelatedNodes!: IGraphProvider["deleteEpisodeWithRelatedNodes"];
  searchEpisodesByEmbedding!: IGraphProvider["searchEpisodesByEmbedding"];
  addLabelsToEpisodes!: IGraphProvider["addLabelsToEpisodes"];
  getEpisodeWithAdjacentChunks!: IGraphProvider["getEpisodeWithAdjacentChunks"];
  getAllSessionChunks!: IGraphProvider["getAllSessionChunks"];
  getSessionMetadata!: IGraphProvider["getSessionMetadata"];
  deleteSession!: IGraphProvider["deleteSession"];
  getUserSessions!: IGraphProvider["getUserSessions"];
  getEpisodesByUserId!: IGraphProvider["getEpisodesByUserId"];
  linkEpisodeToStatement!: IGraphProvider["linkEpisodeToStatement"];
  moveProvenanceToStatement!: IGraphProvider["moveProvenanceToStatement"];
  getStatementsInvalidatedByEpisode!: IGraphProvider["getStatementsInvalidatedByEpisode"];
  invalidateStatementsFromPreviousVersion!: IGraphProvider["invalidateStatementsFromPreviousVersion"];
  getLatestVersionFirstEpisode!: IGraphProvider["getLatestVersionFirstEpisode"];
  updateEpisodeRecallCount!: IGraphProvider["updateEpisodeRecallCount"];
  episodeEntityMatchCount!: IGraphProvider["episodeEntityMatchCount"];

  saveStatement!: IGraphProvider["saveStatement"];
  getStatement!: IGraphProvider["getStatement"];
  deleteStatements!: IGraphProvider["deleteStatements"];
  findSimilarStatements!: IGraphProvider["findSimilarStatements"];
  findContradictoryStatements!: IGraphProvider["findContradictoryStatements"];
  invalidateStatement!: IGraphProvider["invalidateStatement"];
  getStatements!: IGraphProvider["getStatements"];
  findStatementsWithSameSubjectObject!: IGraphProvider["findStatementsWithSameSubjectObject"];
  findContradictoryStatementsBatch!: IGraphProvider["findContradictoryStatementsBatch"];
  findStatementsWithSameSubjectObjectBatch!: IGraphProvider["findStatementsWithSameSubjectObjectBatch"];
  updateStatementRecallCount!: IGraphProvider["updateStatementRecallCount"];
  getEpisodeIdsForStatements!: IGraphProvider["getEpisodeIdsForStatements"];

  saveTriple!: IGraphProvider["saveTriple"];
  getTriplesForEpisode!: IGraphProvider["getTriplesForEpisode"];
  getTriplesForStatementsBatch!: IGraphProvider["getTriplesForStatementsBatch"];

  saveCompactedSession!: IGraphProvider["saveCompactedSession"];
  getCompactedSession!: IGraphProvider["getCompactedSession"];
  getCompactedSessionBySessionId!: IGraphProvider["getCompactedSessionBySessionId"];
  deleteCompactedSession!: IGraphProvider["deleteCompactedSession"];
  getCompactionStats!: IGraphProvider["getCompactionStats"];
  linkEpisodesToCompact!: IGraphProvider["linkEpisodesToCompact"];
  getEpisodesForCompact!: IGraphProvider["getEpisodesForCompact"];
  getSessionEpisodes!: IGraphProvider["getSessionEpisodes"];

  deleteUser!: IGraphProvider["deleteUser"];

  getEpisodesForStatements!: IGraphProvider["getEpisodesForStatements"];
  getEpisodesByIdsWithStatements!: IGraphProvider["getEpisodesByIdsWithStatements"];
  performBM25Search!: IGraphProvider["performBM25Search"];
  bfsGetStatements!: IGraphProvider["bfsGetStatements"];
  bfsFetchStatements!: IGraphProvider["bfsFetchStatements"];
  bfsGetNextLevel!: IGraphProvider["bfsGetNextLevel"];
  performEpisodeGraphSearch!: IGraphProvider["performEpisodeGraphSearch"];
  fetchEpisodesByIds!: IGraphProvider["fetchEpisodesByIds"];

  getClusteredGraphData!: IGraphProvider["getClusteredGraphData"];

  constructor(config: Neo4jConfig) {
    super(config);

    // Compose all domain methods into this instance
    Object.assign(this, createEntityMethods(this));
    Object.assign(this, createEpisodeMethods(this));
    Object.assign(this, createStatementMethods(this));
    Object.assign(this, createTripleMethods(this));
    Object.assign(this, createCompactedSessionMethods(this));
    Object.assign(this, createSearchMethods(this));
    Object.assign(this, createUserMethods(this));
  }
}

// Re-export types for convenience
export type { Neo4jConfig, Neo4jLogger } from "./types";
