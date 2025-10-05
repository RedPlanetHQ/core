import { runQuery } from "~/lib/neo4j.server";
import crypto from "crypto";

export interface ClassNode {
  uuid: string;
  name: string;
  extends?: string;
  implements?: string[];
  methods: string[]; // Method names
  properties: string[];
  startLine: number;
  endLine: number;
  startColumn: number;
  endColumn: number;
  isExport: boolean;
  docstring?: string;
  userId: string;
  workspaceId: string;
  createdAt: Date;
  modifiedAt?: Date;
  deletedAt?: Date;
}

/**
 * Save or update a class node
 */
export async function saveClass(cls: ClassNode): Promise<string> {
  const query = `
    MERGE (c:Class {uuid: $uuid, userId: $userId, workspaceId: $workspaceId})
    ON CREATE SET
      c.name = $name,
      c.extends = $extends,
      c.implements = $implements,
      c.methods = $methods,
      c.properties = $properties,
      c.startLine = $startLine,
      c.endLine = $endLine,
      c.startColumn = $startColumn,
      c.endColumn = $endColumn,
      c.isExport = $isExport,
      c.docstring = $docstring,
      c.createdAt = $createdAt,
      c.modifiedAt = $modifiedAt,
      c.deletedAt = $deletedAt
    ON MATCH SET
      c.name = $name,
      c.extends = $extends,
      c.implements = $implements,
      c.methods = $methods,
      c.properties = $properties,
      c.startLine = $startLine,
      c.endLine = $endLine,
      c.startColumn = $startColumn,
      c.endColumn = $endColumn,
      c.isExport = $isExport,
      c.docstring = $docstring,
      c.modifiedAt = $modifiedAt,
      c.deletedAt = $deletedAt
    RETURN c.uuid as uuid
  `;

  const params = {
    uuid: cls.uuid,
    name: cls.name,
    extends: cls.extends || null,
    implements: cls.implements ? JSON.stringify(cls.implements) : null,
    methods: JSON.stringify(cls.methods),
    properties: JSON.stringify(cls.properties),
    startLine: cls.startLine,
    endLine: cls.endLine,
    startColumn: cls.startColumn,
    endColumn: cls.endColumn,
    isExport: cls.isExport,
    docstring: cls.docstring || null,
    userId: cls.userId,
    workspaceId: cls.workspaceId,
    createdAt: cls.createdAt.toISOString(),
    modifiedAt: cls.modifiedAt ? cls.modifiedAt.toISOString() : new Date().toISOString(),
    deletedAt: cls.deletedAt ? cls.deletedAt.toISOString() : null,
  };

  const result = await runQuery(query, params);
  return result[0].get("uuid");
}

/**
 * Find class by name in a specific file
 */
export async function findClassByName(
  name: string,
  fileUuid: string,
  userId: string,
  workspaceId: string
): Promise<ClassNode | null> {
  const query = `
    MATCH (f:CodeFile {uuid: $fileUuid, userId: $userId, workspaceId: $workspaceId})
    MATCH (f)-[:DEFINES]->(c:Class {name: $name})
    WHERE c.deletedAt IS NULL
    RETURN c
  `;

  const result = await runQuery(query, { name, fileUuid, userId, workspaceId });

  if (result.length === 0) return null;

  const cls = result[0].get("c").properties;
  return {
    uuid: cls.uuid,
    name: cls.name,
    extends: cls.extends,
    implements: cls.implements ? JSON.parse(cls.implements) : undefined,
    methods: JSON.parse(cls.methods),
    properties: JSON.parse(cls.properties),
    startLine: cls.startLine,
    endLine: cls.endLine,
    startColumn: cls.startColumn,
    endColumn: cls.endColumn,
    isExport: cls.isExport,
    docstring: cls.docstring,
    userId: cls.userId,
    workspaceId: cls.workspaceId,
    createdAt: new Date(cls.createdAt),
    modifiedAt: cls.modifiedAt ? new Date(cls.modifiedAt) : undefined,
    deletedAt: cls.deletedAt ? new Date(cls.deletedAt) : undefined,
  };
}

/**
 * Get class by UUID
 */
export async function getClass(
  uuid: string,
  userId: string,
  workspaceId: string
): Promise<ClassNode | null> {
  const query = `
    MATCH (c:Class {uuid: $uuid, userId: $userId, workspaceId: $workspaceId})
    RETURN c
  `;

  const result = await runQuery(query, { uuid, userId, workspaceId });

  if (result.length === 0) return null;

  const cls = result[0].get("c").properties;
  return {
    uuid: cls.uuid,
    name: cls.name,
    extends: cls.extends,
    implements: cls.implements ? JSON.parse(cls.implements) : undefined,
    methods: JSON.parse(cls.methods),
    properties: JSON.parse(cls.properties),
    startLine: cls.startLine,
    endLine: cls.endLine,
    startColumn: cls.startColumn,
    endColumn: cls.endColumn,
    isExport: cls.isExport,
    docstring: cls.docstring,
    userId: cls.userId,
    workspaceId: cls.workspaceId,
    createdAt: new Date(cls.createdAt),
    modifiedAt: cls.modifiedAt ? new Date(cls.modifiedAt) : undefined,
    deletedAt: cls.deletedAt ? new Date(cls.deletedAt) : undefined,
  };
}

/**
 * Link class inheritance (class A extends class B)
 */
export async function linkClassExtends(
  childUuid: string,
  parentUuid: string,
  userId: string,
  workspaceId: string
): Promise<void> {
  const query = `
    MATCH (child:Class {uuid: $childUuid, userId: $userId, workspaceId: $workspaceId})
    MATCH (parent:Class {uuid: $parentUuid, userId: $userId, workspaceId: $workspaceId})
    MERGE (child)-[rel:EXTENDS]->(parent)
    ON CREATE SET rel.uuid = $relUuid, rel.createdAt = $createdAt
    RETURN rel
  `;

  const params = {
    childUuid,
    parentUuid,
    userId,
    workspaceId,
    relUuid: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
  };

  await runQuery(query, params);
}

/**
 * Link class to its method
 */
export async function linkClassMethod(
  classUuid: string,
  methodUuid: string,
  userId: string,
  workspaceId: string
): Promise<void> {
  const query = `
    MATCH (c:Class {uuid: $classUuid, userId: $userId, workspaceId: $workspaceId})
    MATCH (m:Function {uuid: $methodUuid, userId: $userId, workspaceId: $workspaceId})
    MERGE (c)-[rel:HAS_METHOD]->(m)
    ON CREATE SET rel.uuid = $relUuid, rel.createdAt = $createdAt
    RETURN rel
  `;

  const params = {
    classUuid,
    methodUuid,
    userId,
    workspaceId,
    relUuid: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
  };

  await runQuery(query, params);
}

/**
 * Get all methods of a class
 */
export async function getClassMethods(
  classUuid: string,
  userId: string,
  workspaceId: string
): Promise<Array<{ uuid: string; name: string }>> {
  const query = `
    MATCH (c:Class {uuid: $classUuid, userId: $userId, workspaceId: $workspaceId})
    MATCH (c)-[:HAS_METHOD]->(m:Function)
    WHERE m.deletedAt IS NULL
    RETURN m.uuid as uuid, m.name as name
    ORDER BY m.startLine
  `;

  const result = await runQuery(query, { classUuid, userId, workspaceId });

  return result.map((record) => ({
    uuid: record.get("uuid"),
    name: record.get("name"),
  }));
}

/**
 * Get parent class (if any)
 */
export async function getParentClass(
  classUuid: string,
  userId: string,
  workspaceId: string
): Promise<ClassNode | null> {
  const query = `
    MATCH (c:Class {uuid: $classUuid, userId: $userId, workspaceId: $workspaceId})
    MATCH (c)-[:EXTENDS]->(parent:Class)
    WHERE parent.deletedAt IS NULL
    RETURN parent
  `;

  const result = await runQuery(query, { classUuid, userId, workspaceId });

  if (result.length === 0) return null;

  const cls = result[0].get("parent").properties;
  return {
    uuid: cls.uuid,
    name: cls.name,
    extends: cls.extends,
    implements: cls.implements ? JSON.parse(cls.implements) : undefined,
    methods: JSON.parse(cls.methods),
    properties: JSON.parse(cls.properties),
    startLine: cls.startLine,
    endLine: cls.endLine,
    startColumn: cls.startColumn,
    endColumn: cls.endColumn,
    isExport: cls.isExport,
    docstring: cls.docstring,
    userId: cls.userId,
    workspaceId: cls.workspaceId,
    createdAt: new Date(cls.createdAt),
    modifiedAt: cls.modifiedAt ? new Date(cls.modifiedAt) : undefined,
    deletedAt: cls.deletedAt ? new Date(cls.deletedAt) : undefined,
  };
}

/**
 * Get child classes (classes that extend this class)
 */
export async function getChildClasses(
  classUuid: string,
  userId: string,
  workspaceId: string
): Promise<ClassNode[]> {
  const query = `
    MATCH (child:Class)-[:EXTENDS]->(c:Class {uuid: $classUuid, userId: $userId, workspaceId: $workspaceId})
    WHERE child.deletedAt IS NULL
    RETURN child
  `;

  const result = await runQuery(query, { classUuid, userId, workspaceId });

  return result.map((record) => {
    const cls = record.get("child").properties;
    return {
      uuid: cls.uuid,
      name: cls.name,
      extends: cls.extends,
      implements: cls.implements ? JSON.parse(cls.implements) : undefined,
      methods: JSON.parse(cls.methods),
      properties: JSON.parse(cls.properties),
      startLine: cls.startLine,
      endLine: cls.endLine,
      startColumn: cls.startColumn,
      endColumn: cls.endColumn,
      isExport: cls.isExport,
      docstring: cls.docstring,
      userId: cls.userId,
      workspaceId: cls.workspaceId,
      createdAt: new Date(cls.createdAt),
      modifiedAt: cls.modifiedAt ? new Date(cls.modifiedAt) : undefined,
      deletedAt: cls.deletedAt ? new Date(cls.deletedAt) : undefined,
    };
  });
}

/**
 * Search classes by name
 */
export async function searchClasses(
  namePattern: string,
  userId: string,
  workspaceId: string,
  limit: number = 50
): Promise<ClassNode[]> {
  const query = `
    MATCH (c:Class {userId: $userId, workspaceId: $workspaceId})
    WHERE c.name CONTAINS $namePattern AND c.deletedAt IS NULL
    RETURN c
    ORDER BY c.name
    LIMIT $limit
  `;

  const result = await runQuery(query, { namePattern, userId, workspaceId, limit });

  return result.map((record) => {
    const cls = record.get("c").properties;
    return {
      uuid: cls.uuid,
      name: cls.name,
      extends: cls.extends,
      implements: cls.implements ? JSON.parse(cls.implements) : undefined,
      methods: JSON.parse(cls.methods),
      properties: JSON.parse(cls.properties),
      startLine: cls.startLine,
      endLine: cls.endLine,
      startColumn: cls.startColumn,
      endColumn: cls.endColumn,
      isExport: cls.isExport,
      docstring: cls.docstring,
      userId: cls.userId,
      workspaceId: cls.workspaceId,
      createdAt: new Date(cls.createdAt),
      modifiedAt: cls.modifiedAt ? new Date(cls.modifiedAt) : undefined,
      deletedAt: cls.deletedAt ? new Date(cls.deletedAt) : undefined,
    };
  });
}

/**
 * Mark class as deleted (soft delete)
 */
export async function markClassDeleted(
  uuid: string,
  userId: string,
  workspaceId: string
): Promise<void> {
  const query = `
    MATCH (c:Class {uuid: $uuid, userId: $userId, workspaceId: $workspaceId})
    SET c.deletedAt = $deletedAt
    RETURN c.uuid as uuid
  `;

  await runQuery(query, {
    uuid,
    userId,
    workspaceId,
    deletedAt: new Date().toISOString(),
  });
}
