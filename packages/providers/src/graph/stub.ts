/**
 * StubGraphProvider - Placeholder for future graph providers
 * All methods throw "not implemented" errors
 */

import { IGraphProvider } from "./interface";
import type {
  EntityNode,
  EpisodicNode,
  StatementNode,
  Triple,
  SpaceNode,
  SpaceDeletionResult,
  SpaceAssignmentResult,
  CompactedSessionNode,
  AdjacentChunks,
} from "@core/types";

export class StubGraphProvider implements IGraphProvider {
  private providerName: string;

  constructor(providerName: string) {
    this.providerName = providerName;
  }

  private notImplemented(method: string): never {
    throw new Error(
      `${this.providerName}.${method}() not yet implemented. Coming soon!`
    );
  }

  async runQuery<T = any>(
    query: string,
    params?: Record<string, any>
  ): Promise<T[]> {
    this.notImplemented("runQuery");
  }

  async close(): Promise<void> {
    // No-op for stub
  }

  getProviderName(): string {
    return this.providerName;
  }

  async ping(): Promise<boolean> {
    return false;
  }

  supportsEmbeddings(): boolean {
    return false;
  }

  async getCurrentTimestamp(): Promise<Date> {
    this.notImplemented("getCurrentTimestamp");
  }

  async saveEntity(entity: EntityNode): Promise<string> {
    this.notImplemented("saveEntity");
  }

  async getEntity(uuid: string, userId: string): Promise<EntityNode | null> {
    this.notImplemented("getEntity");
  }

  async findSimilarEntities(params: {
    queryEmbedding: number[];
    threshold: number;
    limit: number;
    userId: string;
  }): Promise<Array<{ entity: EntityNode; score: number }>> {
    this.notImplemented("findSimilarEntities");
  }

  async findExactPredicateMatches(params: {
    predicateName: string;
    userId: string;
  }): Promise<EntityNode[]> {
    this.notImplemented("findExactPredicateMatches");
  }

  async findExactEntityMatch(params: {
    entityName: string;
    userId: string;
  }): Promise<EntityNode | null> {
    this.notImplemented("findExactEntityMatch");
  }

  async mergeEntities(
    sourceUuid: string,
    targetUuid: string,
    userId: string
  ): Promise<void> {
    this.notImplemented("mergeEntities");
  }

  async deduplicateEntitiesByName(userId: string): Promise<{ count: number; deletedUuids: string[] }> {
    this.notImplemented("deduplicateEntitiesByName");
  }

  async deleteOrphanedEntities(userId: string): Promise<{ count: number; deletedUuids: string[] }> {
    this.notImplemented("deleteOrphanedEntities");
  }

  async saveEpisode(episode: EpisodicNode): Promise<string> {
    this.notImplemented("saveEpisode");
  }

  async getEpisode(uuid: string, userId: string): Promise<EpisodicNode | null> {
    this.notImplemented("getEpisode");
  }

  async getRecentEpisodes(params: {
    userId: string;
    limit: number;
    labelIds?: string[];
    sessionId?: string;
    source?: string;
    spaceIds?: string[];
  }): Promise<EpisodicNode[]> {
    this.notImplemented("getRecentEpisodes");
  }

  async getEpisodesBySession(
    sessionId: string,
    userId: string
  ): Promise<EpisodicNode[]> {
    this.notImplemented("getEpisodesBySession");
  }

  async deleteEpisodeWithRelatedNodes(
    uuid: string,
    userId: string
  ): Promise<{
    episodesDeleted: number;
    statementsDeleted: number;
    entitiesDeleted: number;
    deletedEpisodeUuids: string[];
    deletedStatementUuids: string[];
    deletedEntityUuids: string[];
  }> {
    this.notImplemented("deleteEpisodeWithRelatedNodes");
  }

  async searchEpisodesByEmbedding(params: {
    queryEmbedding: number[];
    threshold: number;
    limit: number;
    userId: string;
    labelIds?: string[];
    spaceIds?: string[];
  }): Promise<Array<{ episode: EpisodicNode; score: number }>> {
    this.notImplemented("searchEpisodesByEmbedding");
  }

  async addLabelsToEpisodes(
    episodeUuids: string[],
    labelIds: string[],
    userId: string
  ): Promise<void> {
    this.notImplemented("addLabelsToEpisodes");
  }

  async getEpisodeWithAdjacentChunks(
    episodeUuid: string,
    userId: string,
    contextWindow?: number
  ): Promise<AdjacentChunks> {
    this.notImplemented("getEpisodeWithAdjacentChunks");
  }

  async getAllSessionChunks(sessionId: string, userId: string): Promise<EpisodicNode[]> {
    this.notImplemented("getAllSessionChunks");
  }

  async getSessionMetadata(
    sessionId: string,
    userId: string
  ): Promise<EpisodicNode | null> {
    this.notImplemented("getSessionMetadata");
  }

  async deleteSession(
    sessionId: string,
    userId: string
  ): Promise<{
    deleted: boolean;
    episodesDeleted: number;
    statementsDeleted: number;
    entitiesDeleted: number;
  }> {
    this.notImplemented("deleteSession");
  }

  async getUserSessions(params: {
    userId: string;
    type?: string;
    limit?: number;
  }): Promise<EpisodicNode[]> {
    this.notImplemented("getUserSessions");
  }

  async getEpisodesByUserId(params: {
    userId: string;
    startTime?: Date;
    endTime?: Date;
  }): Promise<EpisodicNode[]> {
    this.notImplemented("getEpisodesByUserId");
  }

  async linkEpisodeToStatement(
    episodeUuid: string,
    statementUuid: string,
    userId: string
  ): Promise<void> {
    this.notImplemented("linkEpisodeToStatement");
  }

  async moveProvenanceToStatement(
    sourceStatementUuid: string,
    targetStatementUuid: string,
    userId: string
  ): Promise<number> {
    this.notImplemented("moveProvenanceToStatement");
  }

  async saveStatement(statement: StatementNode): Promise<string> {
    this.notImplemented("saveStatement");
  }

  async getStatement(uuid: string, userId: string): Promise<StatementNode | null> {
    this.notImplemented("getStatement");
  }

  async deleteStatements(uuids: string[], userId: string): Promise<void> {
    this.notImplemented("deleteStatements");
  }

  async findSimilarStatements(params: {
    queryEmbedding: number[];
    threshold: number;
    limit: number;
    userId: string;
    spaceIds?: string[];
  }): Promise<Array<{ statement: StatementNode; score: number }>> {
    this.notImplemented("findSimilarStatements");
  }

  async findContradictoryStatements(params: {
    subjectName: string;
    predicateName: string;
    userId: string;
  }): Promise<StatementNode[]> {
    this.notImplemented("findContradictoryStatements");
  }

  async invalidateStatement(
    uuid: string,
    invalidatedBy: string,
    invalidAt: Date,
    userId: string
  ): Promise<void> {
    this.notImplemented("invalidateStatement");
  }

  async getStatements(uuids: string[], userId: string): Promise<StatementNode[]> {
    this.notImplemented("getStatements");
  }

  async findStatementsWithSameSubjectObject(params: {
    subjectId: string;
    objectId: string;
    excludePredicateId?: string;
    userId: string;
  }): Promise<StatementNode[]> {
    this.notImplemented("findStatementsWithSameSubjectObject");
  }

  async saveTriple(triple: {
    statement: StatementNode;
    subject: EntityNode;
    predicate: EntityNode;
    object: EntityNode;
    episodeUuid: string;
    userId: string;
  }): Promise<string> {
    this.notImplemented("saveTriple");
  }

  async getTriplesForEpisode(episodeUuid: string, userId: string): Promise<Triple[]> {
    this.notImplemented("getTriplesForEpisode");
  }

  async getTriplesForStatementsBatch(
    statementUuids: string[],
    userId: string
  ): Promise<Map<string, Triple>> {
    this.notImplemented("getTriplesForStatementsBatch");
  }

  async createSpace(params: {
    spaceId: string;
    name: string;
    description: string | undefined;
    userId: string;
    summaryStructure?: string;
    type?: string;
  }): Promise<SpaceNode> {
    this.notImplemented("createSpace");
  }

  async getSpace(spaceId: string, userId: string): Promise<SpaceNode | null> {
    this.notImplemented("getSpace");
  }

  async getAllSpacesForUser(userId: string): Promise<SpaceNode[]> {
    this.notImplemented("getAllSpacesForUser");
  }

  async updateSpace(
    spaceId: string,
    updates: {
      name?: string;
      description?: string;
      summaryStructure?: string;
      type?: string;
    },
    userId: string
  ): Promise<SpaceNode> {
    this.notImplemented("updateSpace");
  }

  async deleteSpace(spaceId: string, userId: string): Promise<SpaceDeletionResult> {
    this.notImplemented("deleteSpace");
  }

  async assignEpisodesToSpace(
    episodeIds: string[],
    spaceId: string,
    userId: string
  ): Promise<SpaceAssignmentResult> {
    this.notImplemented("assignEpisodesToSpace");
  }

  async removeEpisodesFromSpace(
    episodeIds: string[],
    spaceId: string,
    userId: string
  ): Promise<SpaceAssignmentResult> {
    this.notImplemented("removeEpisodesFromSpace");
  }

  async getSpaceEpisodes(spaceId: string, userId: string): Promise<EpisodicNode[]> {
    this.notImplemented("getSpaceEpisodes");
  }

  async getSpaceEpisodeCount(spaceId: string, userId: string): Promise<number> {
    this.notImplemented("getSpaceEpisodeCount");
  }

  async getSpacesForEpisodes(
    episodeIds: string[],
    userId: string
  ): Promise<Record<string, string[]>> {
    this.notImplemented("getSpacesForEpisodes");
  }

  async saveCompactedSession(compact: CompactedSessionNode): Promise<string> {
    this.notImplemented("saveCompactedSession");
  }

  async getCompactedSession(
    uuid: string,
    userId: string
  ): Promise<CompactedSessionNode | null> {
    this.notImplemented("getCompactedSession");
  }

  async getCompactedSessionBySessionId(
    sessionId: string,
    userId: string
  ): Promise<CompactedSessionNode | null> {
    this.notImplemented("getCompactedSessionBySessionId");
  }

  async deleteCompactedSession(uuid: string, userId: string): Promise<void> {
    this.notImplemented("deleteCompactedSession");
  }

  async getCompactionStats(userId: string): Promise<{
    totalSessions: number;
    totalEpisodes: number;
    averageCompressionRatio: number;
  }> {
    this.notImplemented("getCompactionStats");
  }

  async linkEpisodesToCompact(
    compactUuid: string,
    episodeUuids: string[],
    userId: string
  ): Promise<void> {
    this.notImplemented("linkEpisodesToCompact");
  }

  async getEpisodesForCompact(
    compactUuid: string,
    userId: string
  ): Promise<EpisodicNode[]> {
    this.notImplemented("getEpisodesForCompact");
  }
}
