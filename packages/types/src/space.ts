/**
 * Space type definitions
 * - classification: Keyword-based filtering (e.g., "Work", "Health")
 * - persona: Personal information space (e.g., "Profile")
 * - evolution: Tracks changes over time
 * - agent: AI agent-specific context
 */
export enum SpaceTypeEnum {
  Classification = "classification",
  Persona = "persona",
  Evolution = "evolution",
}

export const SpaceType = {
  Classification: "classification",
  Persona: "persona",
  Evolution: "evolution",
};

export type SpaceType = (typeof SpaceType)[keyof typeof SpaceType];

/**
 * Space status enum for tracking pipeline progression
 * Represents the current state of space processing
 */
export enum SpaceStatus {
  // Initial state after space creation
  Created = "created",

  // Keywords generated, ready for BERT clustering
  ReadyForClustering = "ready_for_clustering",

  // BERT clustering in progress
  Clustering = "clustering",

  // Episodes assigned, ready for summary generation
  ReadyForSummary = "ready_for_summary",

  // Summary generation in progress
  GeneratingSummary = "generating_summary",

  // All processing complete
  Ready = "ready",

  // Error states
  Error = "error",
  KeywordGenerationFailed = "keyword_generation_failed",
  ClusteringFailed = "clustering_failed",
  SummaryGenerationFailed = "summary_generation_failed",
}

export interface SpaceNode {
  uuid: string;
  name: string;
  description?: string;
  type?: SpaceType;
  summary?: string;
  summaryStructure?: string; // Custom summary template (markdown format)
  topicKeywords?: string[]; // LLM-generated keywords for BERT matching
  userId: string;
  createdAt: Date;
  updatedAt: Date;
  isActive: boolean;
  contextCount?: number; // Computed field - count of episodes assigned to this space
  embedding?: number[]; // For future space similarity
}

export interface CreateSpaceParams {
  name: string;
  description?: string;
  type?: SpaceType;
  summary?: string;
  summaryStructure?: string; // Custom summary template
  userId: string;
  workspaceId: string;
}

export interface UpdateSpaceParams {
  name?: string;
  description?: string;
  type?: SpaceType;
  summaryStructure?: string; 
  summary?: string;
  icon?: string;
  status?: string;
}

export interface SpaceWithStatements extends SpaceNode {
  statements: any[]; // Will be StatementNode[] when imported with graph types
}

export interface AssignStatementsParams {
  statementIds: string[];
  spaceId: string;
  userId: string;
}

export interface SpaceAssignmentResult {
  success: boolean;
  statementsUpdated: number;
  error?: string;
}

export interface SpaceDeletionResult {
  deleted: boolean;
  statementsUpdated: number;
  error?: string;
}
