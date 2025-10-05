import { runQuery } from "~/lib/neo4j.server";
import crypto from "crypto";

export interface RepositoryNode {
  uuid: string;
  fullName: string; // e.g., "owner/repo"
  owner: string;
  name: string;
  url: string;
  defaultBranch?: string;
  userId: string;
  workspaceId: string;
  createdAt: Date;
  modifiedAt?: Date;
}

/**
 * Save or update a repository node
 */
export async function saveRepository(repo: RepositoryNode): Promise<string> {
  const query = `
    MERGE (r:Repository {uuid: $uuid, userId: $userId, workspaceId: $workspaceId})
    ON CREATE SET
      r.fullName = $fullName,
      r.owner = $owner,
      r.name = $name,
      r.url = $url,
      r.defaultBranch = $defaultBranch,
      r.createdAt = $createdAt,
      r.modifiedAt = $modifiedAt
    ON MATCH SET
      r.fullName = $fullName,
      r.owner = $owner,
      r.name = $name,
      r.url = $url,
      r.defaultBranch = $defaultBranch,
      r.modifiedAt = $modifiedAt
    RETURN r.uuid as uuid
  `;

  const params = {
    uuid: repo.uuid,
    fullName: repo.fullName,
    owner: repo.owner,
    name: repo.name,
    url: repo.url,
    defaultBranch: repo.defaultBranch || null,
    userId: repo.userId,
    workspaceId: repo.workspaceId,
    createdAt: repo.createdAt.toISOString(),
    modifiedAt: repo.modifiedAt ? repo.modifiedAt.toISOString() : new Date().toISOString(),
  };

  const result = await runQuery(query, params);
  return result[0].get("uuid");
}

/**
 * Find repository by full name
 */
export async function findRepositoryByName(
  fullName: string,
  userId: string,
  workspaceId: string
): Promise<RepositoryNode | null> {
  const query = `
    MATCH (r:Repository {fullName: $fullName, userId: $userId, workspaceId: $workspaceId})
    RETURN r
  `;

  const result = await runQuery(query, { fullName, userId, workspaceId });

  if (result.length === 0) return null;

  const repo = result[0].get("r").properties;
  return {
    uuid: repo.uuid,
    fullName: repo.fullName,
    owner: repo.owner,
    name: repo.name,
    url: repo.url,
    defaultBranch: repo.defaultBranch,
    userId: repo.userId,
    workspaceId: repo.workspaceId,
    createdAt: new Date(repo.createdAt),
    modifiedAt: repo.modifiedAt ? new Date(repo.modifiedAt) : undefined,
  };
}

/**
 * Find repository by UUID
 */
export async function getRepository(
  uuid: string,
  userId: string,
  workspaceId: string
): Promise<RepositoryNode | null> {
  const query = `
    MATCH (r:Repository {uuid: $uuid, userId: $userId, workspaceId: $workspaceId})
    RETURN r
  `;

  const result = await runQuery(query, { uuid, userId, workspaceId });

  if (result.length === 0) return null;

  const repo = result[0].get("r").properties;
  return {
    uuid: repo.uuid,
    fullName: repo.fullName,
    owner: repo.owner,
    name: repo.name,
    url: repo.url,
    defaultBranch: repo.defaultBranch,
    userId: repo.userId,
    workspaceId: repo.workspaceId,
    createdAt: new Date(repo.createdAt),
    modifiedAt: repo.modifiedAt ? new Date(repo.modifiedAt) : undefined,
  };
}

/**
 * Link repository to a code file
 */
export async function linkRepositoryToFile(
  repositoryUuid: string,
  fileUuid: string,
  userId: string,
  workspaceId: string
): Promise<void> {
  const query = `
    MATCH (r:Repository {uuid: $repositoryUuid, userId: $userId, workspaceId: $workspaceId})
    MATCH (f:CodeFile {uuid: $fileUuid, userId: $userId, workspaceId: $workspaceId})
    MERGE (r)-[rel:CONTAINS]->(f)
    ON CREATE SET rel.uuid = $relUuid, rel.createdAt = $createdAt
    RETURN rel
  `;

  const params = {
    repositoryUuid,
    fileUuid,
    userId,
    workspaceId,
    relUuid: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
  };

  await runQuery(query, params);
}

/**
 * Get all files in a repository
 */
export async function getRepositoryFiles(
  repositoryUuid: string,
  userId: string,
  workspaceId: string
): Promise<Array<{ uuid: string; path: string }>> {
  const query = `
    MATCH (r:Repository {uuid: $repositoryUuid, userId: $userId, workspaceId: $workspaceId})
    MATCH (r)-[:CONTAINS]->(f:CodeFile)
    WHERE f.deletedAt IS NULL
    RETURN f.uuid as uuid, f.path as path
    ORDER BY f.path
  `;

  const result = await runQuery(query, { repositoryUuid, userId, workspaceId });

  return result.map((record) => ({
    uuid: record.get("uuid"),
    path: record.get("path"),
  }));
}

/**
 * List all repositories for a user/workspace
 */
export async function listRepositories(
  userId: string,
  workspaceId: string
): Promise<RepositoryNode[]> {
  const query = `
    MATCH (r:Repository {userId: $userId, workspaceId: $workspaceId})
    RETURN r
    ORDER BY r.fullName
  `;

  const result = await runQuery(query, { userId, workspaceId });

  return result.map((record) => {
    const repo = record.get("r").properties;
    return {
      uuid: repo.uuid,
      fullName: repo.fullName,
      owner: repo.owner,
      name: repo.name,
      url: repo.url,
      defaultBranch: repo.defaultBranch,
      userId: repo.userId,
      workspaceId: repo.workspaceId,
      createdAt: new Date(repo.createdAt),
      modifiedAt: repo.modifiedAt ? new Date(repo.modifiedAt) : undefined,
    };
  });
}
