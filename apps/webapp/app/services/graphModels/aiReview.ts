import { runQuery } from "~/lib/neo4j.server";
import crypto from "crypto";

export interface AIReviewNode {
  uuid: string;
  author: string; // AI service name (e.g., "Claude", "GitHub Copilot")
  service: string; // Platform (e.g., "claude.ai", "github")
  commentBody: string;
  repository: string;
  prNumber?: number;
  filePath: string;
  lineNumber?: number;
  commitSha?: string;
  commentUrl?: string;
  userId: string;
  workspaceId: string;
  createdAt: Date;
}

/**
 * Save an AI review node
 */
export async function saveAIReview(review: AIReviewNode): Promise<string> {
  const query = `
    MERGE (r:AIReview {uuid: $uuid, userId: $userId, workspaceId: $workspaceId})
    ON CREATE SET
      r.author = $author,
      r.service = $service,
      r.commentBody = $commentBody,
      r.repository = $repository,
      r.prNumber = $prNumber,
      r.filePath = $filePath,
      r.lineNumber = $lineNumber,
      r.commitSha = $commitSha,
      r.commentUrl = $commentUrl,
      r.createdAt = $createdAt
    ON MATCH SET
      r.author = $author,
      r.service = $service,
      r.commentBody = $commentBody,
      r.repository = $repository,
      r.prNumber = $prNumber,
      r.filePath = $filePath,
      r.lineNumber = $lineNumber,
      r.commitSha = $commitSha,
      r.commentUrl = $commentUrl
    RETURN r.uuid as uuid
  `;

  const params = {
    uuid: review.uuid,
    author: review.author,
    service: review.service,
    commentBody: review.commentBody,
    repository: review.repository,
    prNumber: review.prNumber || null,
    filePath: review.filePath,
    lineNumber: review.lineNumber || null,
    commitSha: review.commitSha || null,
    commentUrl: review.commentUrl || null,
    userId: review.userId,
    workspaceId: review.workspaceId,
    createdAt: review.createdAt.toISOString(),
  };

  const result = await runQuery(query, params);
  return result[0].get("uuid");
}

/**
 * Get AI review by UUID
 */
export async function getAIReview(
  uuid: string,
  userId: string,
  workspaceId: string
): Promise<AIReviewNode | null> {
  const query = `
    MATCH (r:AIReview {uuid: $uuid, userId: $userId, workspaceId: $workspaceId})
    RETURN r
  `;

  const result = await runQuery(query, { uuid, userId, workspaceId });

  if (result.length === 0) return null;

  const review = result[0].get("r").properties;
  return {
    uuid: review.uuid,
    author: review.author,
    service: review.service,
    commentBody: review.commentBody,
    repository: review.repository,
    prNumber: review.prNumber,
    filePath: review.filePath,
    lineNumber: review.lineNumber,
    commitSha: review.commitSha,
    commentUrl: review.commentUrl,
    userId: review.userId,
    workspaceId: review.workspaceId,
    createdAt: new Date(review.createdAt),
  };
}

/**
 * Link AI review to a code file
 */
export async function linkReviewToFile(
  reviewUuid: string,
  fileUuid: string,
  userId: string,
  workspaceId: string
): Promise<void> {
  const query = `
    MATCH (r:AIReview {uuid: $reviewUuid, userId: $userId, workspaceId: $workspaceId})
    MATCH (f:CodeFile {uuid: $fileUuid, userId: $userId, workspaceId: $workspaceId})
    MERGE (r)-[rel:REVIEWS]->(f)
    ON CREATE SET rel.uuid = $relUuid, rel.createdAt = $createdAt
    RETURN rel
  `;

  const params = {
    reviewUuid,
    fileUuid,
    userId,
    workspaceId,
    relUuid: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
  };

  await runQuery(query, params);
}

/**
 * Link AI review to a function
 */
export async function linkReviewToFunction(
  reviewUuid: string,
  functionUuid: string,
  userId: string,
  workspaceId: string
): Promise<void> {
  const query = `
    MATCH (r:AIReview {uuid: $reviewUuid, userId: $userId, workspaceId: $workspaceId})
    MATCH (f:Function {uuid: $functionUuid, userId: $userId, workspaceId: $workspaceId})
    MERGE (r)-[rel:REVIEWS]->(f)
    ON CREATE SET rel.uuid = $relUuid, rel.createdAt = $createdAt
    RETURN rel
  `;

  const params = {
    reviewUuid,
    functionUuid,
    userId,
    workspaceId,
    relUuid: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
  };

  await runQuery(query, params);
}

/**
 * Link AI review to a class
 */
export async function linkReviewToClass(
  reviewUuid: string,
  classUuid: string,
  userId: string,
  workspaceId: string
): Promise<void> {
  const query = `
    MATCH (r:AIReview {uuid: $reviewUuid, userId: $userId, workspaceId: $workspaceId})
    MATCH (c:Class {uuid: $classUuid, userId: $userId, workspaceId: $workspaceId})
    MERGE (r)-[rel:REVIEWS]->(c)
    ON CREATE SET rel.uuid = $relUuid, rel.createdAt = $createdAt
    RETURN rel
  `;

  const params = {
    reviewUuid,
    classUuid,
    userId,
    workspaceId,
    relUuid: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
  };

  await runQuery(query, params);
}

/**
 * Get all AI reviews for a code file
 */
export async function getFileReviews(
  fileUuid: string,
  userId: string,
  workspaceId: string
): Promise<AIReviewNode[]> {
  const query = `
    MATCH (r:AIReview)-[:REVIEWS]->(f:CodeFile {uuid: $fileUuid, userId: $userId, workspaceId: $workspaceId})
    RETURN r
    ORDER BY r.createdAt DESC
  `;

  const result = await runQuery(query, { fileUuid, userId, workspaceId });

  return result.map((record) => {
    const review = record.get("r").properties;
    return {
      uuid: review.uuid,
      author: review.author,
      service: review.service,
      commentBody: review.commentBody,
      repository: review.repository,
      prNumber: review.prNumber,
      filePath: review.filePath,
      lineNumber: review.lineNumber,
      commitSha: review.commitSha,
      commentUrl: review.commentUrl,
      userId: review.userId,
      workspaceId: review.workspaceId,
      createdAt: new Date(review.createdAt),
    };
  });
}

/**
 * Get all AI reviews for a function
 */
export async function getFunctionReviews(
  functionUuid: string,
  userId: string,
  workspaceId: string
): Promise<AIReviewNode[]> {
  const query = `
    MATCH (r:AIReview)-[:REVIEWS]->(f:Function {uuid: $functionUuid, userId: $userId, workspaceId: $workspaceId})
    RETURN r
    ORDER BY r.createdAt DESC
  `;

  const result = await runQuery(query, { functionUuid, userId, workspaceId });

  return result.map((record) => {
    const review = record.get("r").properties;
    return {
      uuid: review.uuid,
      author: review.author,
      service: review.service,
      commentBody: review.commentBody,
      repository: review.repository,
      prNumber: review.prNumber,
      filePath: review.filePath,
      lineNumber: review.lineNumber,
      commitSha: review.commitSha,
      commentUrl: review.commentUrl,
      userId: review.userId,
      workspaceId: review.workspaceId,
      createdAt: new Date(review.createdAt),
    };
  });
}

/**
 * Get all AI reviews for a class
 */
export async function getClassReviews(
  classUuid: string,
  userId: string,
  workspaceId: string
): Promise<AIReviewNode[]> {
  const query = `
    MATCH (r:AIReview)-[:REVIEWS]->(c:Class {uuid: $classUuid, userId: $userId, workspaceId: $workspaceId})
    RETURN r
    ORDER BY r.createdAt DESC
  `;

  const result = await runQuery(query, { classUuid, userId, workspaceId });

  return result.map((record) => {
    const review = record.get("r").properties;
    return {
      uuid: review.uuid,
      author: review.author,
      service: review.service,
      commentBody: review.commentBody,
      repository: review.repository,
      prNumber: review.prNumber,
      filePath: review.filePath,
      lineNumber: review.lineNumber,
      commitSha: review.commitSha,
      commentUrl: review.commentUrl,
      userId: review.userId,
      workspaceId: review.workspaceId,
      createdAt: new Date(review.createdAt),
    };
  });
}

/**
 * Find AI reviews by file path and line number
 */
export async function findReviewsByFileAndLine(
  filePath: string,
  lineNumber: number,
  userId: string,
  workspaceId: string
): Promise<AIReviewNode[]> {
  const query = `
    MATCH (r:AIReview {filePath: $filePath, lineNumber: $lineNumber, userId: $userId, workspaceId: $workspaceId})
    RETURN r
    ORDER BY r.createdAt DESC
  `;

  const result = await runQuery(query, { filePath, lineNumber, userId, workspaceId });

  return result.map((record) => {
    const review = record.get("r").properties;
    return {
      uuid: review.uuid,
      author: review.author,
      service: review.service,
      commentBody: review.commentBody,
      repository: review.repository,
      prNumber: review.prNumber,
      filePath: review.filePath,
      lineNumber: review.lineNumber,
      commitSha: review.commitSha,
      commentUrl: review.commentUrl,
      userId: review.userId,
      workspaceId: review.workspaceId,
      createdAt: new Date(review.createdAt),
    };
  });
}

/**
 * Search AI reviews by author or service
 */
export async function searchReviews(
  params: {
    author?: string;
    service?: string;
    repository?: string;
    userId: string;
    workspaceId: string;
    limit?: number;
  }
): Promise<AIReviewNode[]> {
  const conditions: string[] = ["r.userId = $userId", "r.workspaceId = $workspaceId"];
  const queryParams: any = {
    userId: params.userId,
    workspaceId: params.workspaceId,
    limit: params.limit || 50,
  };

  if (params.author) {
    conditions.push("r.author = $author");
    queryParams.author = params.author;
  }

  if (params.service) {
    conditions.push("r.service = $service");
    queryParams.service = params.service;
  }

  if (params.repository) {
    conditions.push("r.repository = $repository");
    queryParams.repository = params.repository;
  }

  const query = `
    MATCH (r:AIReview)
    WHERE ${conditions.join(" AND ")}
    RETURN r
    ORDER BY r.createdAt DESC
    LIMIT $limit
  `;

  const result = await runQuery(query, queryParams);

  return result.map((record) => {
    const review = record.get("r").properties;
    return {
      uuid: review.uuid,
      author: review.author,
      service: review.service,
      commentBody: review.commentBody,
      repository: review.repository,
      prNumber: review.prNumber,
      filePath: review.filePath,
      lineNumber: review.lineNumber,
      commitSha: review.commitSha,
      commentUrl: review.commentUrl,
      userId: review.userId,
      workspaceId: review.workspaceId,
      createdAt: new Date(review.createdAt),
    };
  });
}
