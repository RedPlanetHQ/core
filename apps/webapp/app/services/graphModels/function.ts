import { runQuery } from "~/lib/neo4j.server";
import crypto from "crypto";

export interface FunctionNode {
  uuid: string;
  name: string;
  params: string[];
  returnType?: string;
  startLine: number;
  endLine: number;
  startColumn: number;
  endColumn: number;
  isAsync: boolean;
  isExport: boolean;
  docstring?: string;
  userId: string;
  workspaceId: string;
  createdAt: Date;
  modifiedAt?: Date;
  deletedAt?: Date;
}

/**
 * Save or update a function node
 */
export async function saveFunction(func: FunctionNode): Promise<string> {
  const query = `
    MERGE (fn:Function {uuid: $uuid, userId: $userId, workspaceId: $workspaceId})
    ON CREATE SET
      fn.name = $name,
      fn.params = $params,
      fn.returnType = $returnType,
      fn.startLine = $startLine,
      fn.endLine = $endLine,
      fn.startColumn = $startColumn,
      fn.endColumn = $endColumn,
      fn.isAsync = $isAsync,
      fn.isExport = $isExport,
      fn.docstring = $docstring,
      fn.createdAt = $createdAt,
      fn.modifiedAt = $modifiedAt,
      fn.deletedAt = $deletedAt
    ON MATCH SET
      fn.name = $name,
      fn.params = $params,
      fn.returnType = $returnType,
      fn.startLine = $startLine,
      fn.endLine = $endLine,
      fn.startColumn = $startColumn,
      fn.endColumn = $endColumn,
      fn.isAsync = $isAsync,
      fn.isExport = $isExport,
      fn.docstring = $docstring,
      fn.modifiedAt = $modifiedAt,
      fn.deletedAt = $deletedAt
    RETURN fn.uuid as uuid
  `;

  const params = {
    uuid: func.uuid,
    name: func.name,
    params: JSON.stringify(func.params),
    returnType: func.returnType || null,
    startLine: func.startLine,
    endLine: func.endLine,
    startColumn: func.startColumn,
    endColumn: func.endColumn,
    isAsync: func.isAsync,
    isExport: func.isExport,
    docstring: func.docstring || null,
    userId: func.userId,
    workspaceId: func.workspaceId,
    createdAt: func.createdAt.toISOString(),
    modifiedAt: func.modifiedAt ? func.modifiedAt.toISOString() : new Date().toISOString(),
    deletedAt: func.deletedAt ? func.deletedAt.toISOString() : null,
  };

  const result = await runQuery(query, params);
  return result[0].get("uuid");
}

/**
 * Find function by name in a specific file
 */
export async function findFunctionByName(
  name: string,
  fileUuid: string,
  userId: string,
  workspaceId: string
): Promise<FunctionNode | null> {
  const query = `
    MATCH (f:CodeFile {uuid: $fileUuid, userId: $userId, workspaceId: $workspaceId})
    MATCH (f)-[:DEFINES]->(fn:Function {name: $name})
    WHERE fn.deletedAt IS NULL
    RETURN fn
  `;

  const result = await runQuery(query, { name, fileUuid, userId, workspaceId });

  if (result.length === 0) return null;

  const func = result[0].get("fn").properties;
  return {
    uuid: func.uuid,
    name: func.name,
    params: JSON.parse(func.params),
    returnType: func.returnType,
    startLine: func.startLine,
    endLine: func.endLine,
    startColumn: func.startColumn,
    endColumn: func.endColumn,
    isAsync: func.isAsync,
    isExport: func.isExport,
    docstring: func.docstring,
    userId: func.userId,
    workspaceId: func.workspaceId,
    createdAt: new Date(func.createdAt),
    modifiedAt: func.modifiedAt ? new Date(func.modifiedAt) : undefined,
    deletedAt: func.deletedAt ? new Date(func.deletedAt) : undefined,
  };
}

/**
 * Get function by UUID
 */
export async function getFunction(
  uuid: string,
  userId: string,
  workspaceId: string
): Promise<FunctionNode | null> {
  const query = `
    MATCH (fn:Function {uuid: $uuid, userId: $userId, workspaceId: $workspaceId})
    RETURN fn
  `;

  const result = await runQuery(query, { uuid, userId, workspaceId });

  if (result.length === 0) return null;

  const func = result[0].get("fn").properties;
  return {
    uuid: func.uuid,
    name: func.name,
    params: JSON.parse(func.params),
    returnType: func.returnType,
    startLine: func.startLine,
    endLine: func.endLine,
    startColumn: func.startColumn,
    endColumn: func.endColumn,
    isAsync: func.isAsync,
    isExport: func.isExport,
    docstring: func.docstring,
    userId: func.userId,
    workspaceId: func.workspaceId,
    createdAt: new Date(func.createdAt),
    modifiedAt: func.modifiedAt ? new Date(func.modifiedAt) : undefined,
    deletedAt: func.deletedAt ? new Date(func.deletedAt) : undefined,
  };
}

/**
 * Link function call relationship (function A calls function B)
 */
export async function linkFunctionCall(
  callerUuid: string,
  calleeUuid: string,
  userId: string,
  workspaceId: string
): Promise<void> {
  const query = `
    MATCH (caller:Function {uuid: $callerUuid, userId: $userId, workspaceId: $workspaceId})
    MATCH (callee:Function {uuid: $calleeUuid, userId: $userId, workspaceId: $workspaceId})
    MERGE (caller)-[rel:CALLS]->(callee)
    ON CREATE SET rel.uuid = $relUuid, rel.createdAt = $createdAt
    RETURN rel
  `;

  const params = {
    callerUuid,
    calleeUuid,
    userId,
    workspaceId,
    relUuid: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
  };

  await runQuery(query, params);
}

/**
 * Link function import relationship
 */
export async function linkFunctionImport(
  importerUuid: string,
  importedUuid: string,
  userId: string,
  workspaceId: string
): Promise<void> {
  const query = `
    MATCH (importer:Function {uuid: $importerUuid, userId: $userId, workspaceId: $workspaceId})
    MATCH (imported:Function {uuid: $importedUuid, userId: $userId, workspaceId: $workspaceId})
    MERGE (importer)-[rel:IMPORTS]->(imported)
    ON CREATE SET rel.uuid = $relUuid, rel.createdAt = $createdAt
    RETURN rel
  `;

  const params = {
    importerUuid,
    importedUuid,
    userId,
    workspaceId,
    relUuid: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
  };

  await runQuery(query, params);
}

/**
 * Get all functions that this function calls
 */
export async function getFunctionCalls(
  functionUuid: string,
  userId: string,
  workspaceId: string
): Promise<Array<{ uuid: string; name: string }>> {
  const query = `
    MATCH (fn:Function {uuid: $functionUuid, userId: $userId, workspaceId: $workspaceId})
    MATCH (fn)-[:CALLS]->(called:Function)
    WHERE called.deletedAt IS NULL
    RETURN called.uuid as uuid, called.name as name
  `;

  const result = await runQuery(query, { functionUuid, userId, workspaceId });

  return result.map((record) => ({
    uuid: record.get("uuid"),
    name: record.get("name"),
  }));
}

/**
 * Get all functions that call this function
 */
export async function getFunctionCallers(
  functionUuid: string,
  userId: string,
  workspaceId: string
): Promise<Array<{ uuid: string; name: string }>> {
  const query = `
    MATCH (caller:Function)-[:CALLS]->(fn:Function {uuid: $functionUuid, userId: $userId, workspaceId: $workspaceId})
    WHERE caller.deletedAt IS NULL
    RETURN caller.uuid as uuid, caller.name as name
  `;

  const result = await runQuery(query, { functionUuid, userId, workspaceId });

  return result.map((record) => ({
    uuid: record.get("uuid"),
    name: record.get("name"),
  }));
}

/**
 * Search functions by name
 */
export async function searchFunctions(
  namePattern: string,
  userId: string,
  workspaceId: string,
  limit: number = 50
): Promise<FunctionNode[]> {
  const query = `
    MATCH (fn:Function {userId: $userId, workspaceId: $workspaceId})
    WHERE fn.name CONTAINS $namePattern AND fn.deletedAt IS NULL
    RETURN fn
    ORDER BY fn.name
    LIMIT $limit
  `;

  const result = await runQuery(query, { namePattern, userId, workspaceId, limit });

  return result.map((record) => {
    const func = record.get("fn").properties;
    return {
      uuid: func.uuid,
      name: func.name,
      params: JSON.parse(func.params),
      returnType: func.returnType,
      startLine: func.startLine,
      endLine: func.endLine,
      startColumn: func.startColumn,
      endColumn: func.endColumn,
      isAsync: func.isAsync,
      isExport: func.isExport,
      docstring: func.docstring,
      userId: func.userId,
      workspaceId: func.workspaceId,
      createdAt: new Date(func.createdAt),
      modifiedAt: func.modifiedAt ? new Date(func.modifiedAt) : undefined,
      deletedAt: func.deletedAt ? new Date(func.deletedAt) : undefined,
    };
  });
}

/**
 * Mark function as deleted (soft delete)
 */
export async function markFunctionDeleted(
  uuid: string,
  userId: string,
  workspaceId: string
): Promise<void> {
  const query = `
    MATCH (fn:Function {uuid: $uuid, userId: $userId, workspaceId: $workspaceId})
    SET fn.deletedAt = $deletedAt
    RETURN fn.uuid as uuid
  `;

  await runQuery(query, {
    uuid,
    userId,
    workspaceId,
    deletedAt: new Date().toISOString(),
  });
}
