import { runQuery } from "~/lib/neo4j.server";
import crypto from "crypto";

export interface CodeFileNode {
  uuid: string;
  path: string;
  language: string;
  content?: string;
  commitSha?: string;
  branch?: string;
  userId: string;
  workspaceId: string;
  createdAt: Date;
  modifiedAt?: Date;
  deletedAt?: Date;
}

/**
 * Save or update a code file node
 */
export async function saveCodeFile(file: CodeFileNode): Promise<string> {
  const query = `
    MERGE (f:CodeFile {path: $path, userId: $userId, workspaceId: $workspaceId})
    ON CREATE SET
      f.uuid = $uuid,
      f.language = $language,
      f.content = $content,
      f.commitSha = $commitSha,
      f.branch = $branch,
      f.createdAt = $createdAt,
      f.modifiedAt = $modifiedAt,
      f.deletedAt = $deletedAt
    ON MATCH SET
      f.language = $language,
      f.content = $content,
      f.commitSha = $commitSha,
      f.branch = $branch,
      f.modifiedAt = $modifiedAt,
      f.deletedAt = $deletedAt
    RETURN f.uuid as uuid
  `;

  const params = {
    uuid: file.uuid,
    path: file.path,
    language: file.language,
    content: file.content || null,
    commitSha: file.commitSha || null,
    branch: file.branch || null,
    userId: file.userId,
    workspaceId: file.workspaceId,
    createdAt: file.createdAt.toISOString(),
    modifiedAt: file.modifiedAt ? file.modifiedAt.toISOString() : new Date().toISOString(),
    deletedAt: file.deletedAt ? file.deletedAt.toISOString() : null,
  };

  const result = await runQuery(query, params);
  return result[0].get("uuid");
}

/**
 * Find code file by path
 */
export async function findCodeFileByPath(
  path: string,
  userId: string,
  workspaceId: string
): Promise<CodeFileNode | null> {
  const query = `
    MATCH (f:CodeFile {path: $path, userId: $userId, workspaceId: $workspaceId})
    RETURN f
  `;

  const result = await runQuery(query, { path, userId, workspaceId });

  if (result.length === 0) return null;

  const file = result[0].get("f").properties;
  return {
    uuid: file.uuid,
    path: file.path,
    language: file.language,
    content: file.content,
    commitSha: file.commitSha,
    branch: file.branch,
    userId: file.userId,
    workspaceId: file.workspaceId,
    createdAt: new Date(file.createdAt),
    modifiedAt: file.modifiedAt ? new Date(file.modifiedAt) : undefined,
    deletedAt: file.deletedAt ? new Date(file.deletedAt) : undefined,
  };
}

/**
 * Get code file by UUID
 */
export async function getCodeFile(
  uuid: string,
  userId: string,
  workspaceId: string
): Promise<CodeFileNode | null> {
  const query = `
    MATCH (f:CodeFile {uuid: $uuid, userId: $userId, workspaceId: $workspaceId})
    RETURN f
  `;

  const result = await runQuery(query, { uuid, userId, workspaceId });

  if (result.length === 0) return null;

  const file = result[0].get("f").properties;
  return {
    uuid: file.uuid,
    path: file.path,
    language: file.language,
    content: file.content,
    commitSha: file.commitSha,
    branch: file.branch,
    userId: file.userId,
    workspaceId: file.workspaceId,
    createdAt: new Date(file.createdAt),
    modifiedAt: file.modifiedAt ? new Date(file.modifiedAt) : undefined,
    deletedAt: file.deletedAt ? new Date(file.deletedAt) : undefined,
  };
}

/**
 * Mark file as deleted (soft delete)
 */
export async function markFileDeleted(
  path: string,
  userId: string,
  workspaceId: string
): Promise<void> {
  const query = `
    MATCH (f:CodeFile {path: $path, userId: $userId, workspaceId: $workspaceId})
    SET f.deletedAt = $deletedAt
    RETURN f.uuid as uuid
  `;

  await runQuery(query, {
    path,
    userId,
    workspaceId,
    deletedAt: new Date().toISOString(),
  });
}

/**
 * Link code file to a function it defines
 */
export async function linkFileToFunction(
  fileUuid: string,
  functionUuid: string,
  userId: string,
  workspaceId: string
): Promise<void> {
  const query = `
    MATCH (f:CodeFile {uuid: $fileUuid, userId: $userId, workspaceId: $workspaceId})
    MATCH (fn:Function {uuid: $functionUuid, userId: $userId, workspaceId: $workspaceId})
    MERGE (f)-[rel:DEFINES]->(fn)
    ON CREATE SET rel.uuid = $relUuid, rel.createdAt = $createdAt
    RETURN rel
  `;

  const params = {
    fileUuid,
    functionUuid,
    userId,
    workspaceId,
    relUuid: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
  };

  await runQuery(query, params);
}

/**
 * Link code file to a class it defines
 */
export async function linkFileToClass(
  fileUuid: string,
  classUuid: string,
  userId: string,
  workspaceId: string
): Promise<void> {
  const query = `
    MATCH (f:CodeFile {uuid: $fileUuid, userId: $userId, workspaceId: $workspaceId})
    MATCH (c:Class {uuid: $classUuid, userId: $userId, workspaceId: $workspaceId})
    MERGE (f)-[rel:DEFINES]->(c)
    ON CREATE SET rel.uuid = $relUuid, rel.createdAt = $createdAt
    RETURN rel
  `;

  const params = {
    fileUuid,
    classUuid,
    userId,
    workspaceId,
    relUuid: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
  };

  await runQuery(query, params);
}

/**
 * Get all functions defined in a file
 */
export async function getFileFunctions(
  fileUuid: string,
  userId: string,
  workspaceId: string
): Promise<Array<{ uuid: string; name: string }>> {
  const query = `
    MATCH (f:CodeFile {uuid: $fileUuid, userId: $userId, workspaceId: $workspaceId})
    MATCH (f)-[:DEFINES]->(fn:Function)
    WHERE fn.deletedAt IS NULL
    RETURN fn.uuid as uuid, fn.name as name
    ORDER BY fn.startLine
  `;

  const result = await runQuery(query, { fileUuid, userId, workspaceId });

  return result.map((record) => ({
    uuid: record.get("uuid"),
    name: record.get("name"),
  }));
}

/**
 * Get all classes defined in a file
 */
export async function getFileClasses(
  fileUuid: string,
  userId: string,
  workspaceId: string
): Promise<Array<{ uuid: string; name: string }>> {
  const query = `
    MATCH (f:CodeFile {uuid: $fileUuid, userId: $userId, workspaceId: $workspaceId})
    MATCH (f)-[:DEFINES]->(c:Class)
    WHERE c.deletedAt IS NULL
    RETURN c.uuid as uuid, c.name as name
    ORDER BY c.startLine
  `;

  const result = await runQuery(query, { fileUuid, userId, workspaceId });

  return result.map((record) => ({
    uuid: record.get("uuid"),
    name: record.get("name"),
  }));
}

/**
 * Search code files by path pattern
 */
export async function searchCodeFiles(
  pathPattern: string,
  userId: string,
  workspaceId: string,
  limit: number = 50
): Promise<CodeFileNode[]> {
  const query = `
    MATCH (f:CodeFile {userId: $userId, workspaceId: $workspaceId})
    WHERE f.path CONTAINS $pathPattern AND f.deletedAt IS NULL
    RETURN f
    ORDER BY f.modifiedAt DESC
    LIMIT $limit
  `;

  const result = await runQuery(query, { pathPattern, userId, workspaceId, limit });

  return result.map((record) => {
    const file = record.get("f").properties;
    return {
      uuid: file.uuid,
      path: file.path,
      language: file.language,
      content: file.content,
      commitSha: file.commitSha,
      branch: file.branch,
      userId: file.userId,
      workspaceId: file.workspaceId,
      createdAt: new Date(file.createdAt),
      modifiedAt: file.modifiedAt ? new Date(file.modifiedAt) : undefined,
      deletedAt: file.deletedAt ? new Date(file.deletedAt) : undefined,
    };
  });
}
