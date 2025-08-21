export interface SpaceNode {
  uuid: string;
  name: string;
  description?: string;
  userId: string;
  createdAt: Date;
  updatedAt: Date;
  isActive: boolean;
  statementCount?: number; // Computed field
  embedding?: number[]; // For future space similarity
}

export interface CreateSpaceParams {
  name: string;
  description?: string;
  userId: string;
  workspaceId: string;
}

export interface UpdateSpaceParams {
  name?: string;
  description?: string;
  icon?: string;
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
