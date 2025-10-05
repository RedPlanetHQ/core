import { task, queue } from "@trigger.dev/sdk";
import { z } from "zod";
import { logger } from "~/services/logger.service";
import { parseFile } from "~/services/codeParser.server";
import { extractEntities } from "~/services/codeEntityExtractor.server";
import {
  saveRepository,
  findRepositoryByName,
  linkRepositoryToFile,
  type RepositoryNode,
} from "~/services/graphModels/repository";
import {
  saveCodeFile,
  findCodeFileByPath,
  linkFileToFunction,
  linkFileToClass,
  markFileDeleted,
  type CodeFileNode,
} from "~/services/graphModels/codeFile";
import {
  saveFunction,
  findFunctionByName,
  linkFunctionCall,
  markFunctionDeleted,
  type FunctionNode,
} from "~/services/graphModels/function";
import {
  saveClass,
  findClassByName,
  linkClassExtends,
  linkClassMethod,
  markClassDeleted,
  type ClassNode,
} from "~/services/graphModels/class";
import {
  saveAIReview,
  linkReviewToFile,
  linkReviewToFunction,
  linkReviewToClass,
  findReviewsByFileAndLine,
} from "~/services/graphModels/aiReview";
import axios from "axios";
import crypto from "crypto";

// Zod schema for code parse job
const CodeParseJobSchema = z.object({
  repository: z.string(),
  owner: z.string(),
  repo: z.string(),
  branch: z.string().optional(),
  commit_sha: z.string().optional(),
  files: z.array(
    z.object({
      path: z.string(),
      status: z.enum(["added", "modified", "removed"]),
      additions: z.number().optional(),
      deletions: z.number().optional(),
    })
  ),
  event_type: z.string(),
  pr_number: z.number().optional(),
  github_token: z.string(),
});

const codeIngestionQueue = queue({
  name: "code-ingestion-queue",
  concurrencyLimit: 2,
});

/**
 * Trigger task for ingesting code from GitHub
 */
export const ingestCodeTask = task({
  id: "ingest-code",
  queue: codeIngestionQueue,
  machine: "medium-2x",
  run: async (payload: {
    body: z.infer<typeof CodeParseJobSchema>;
    userId: string;
    workspaceId: string;
    integrationId: string;
  }) => {
    try {
      logger.log(`Processing code ingestion for ${payload.body.repository}`);

      const { repository, owner, repo, branch, commit_sha, files, github_token, pr_number } =
        payload.body;
      const { userId, workspaceId } = payload;

      // Step 1: Get or create repository node
      let repoNode = await findRepositoryByName(repository, userId, workspaceId);

      if (!repoNode) {
        repoNode = {
          uuid: crypto.randomUUID(),
          fullName: repository,
          owner,
          name: repo,
          url: `https://github.com/${repository}`,
          defaultBranch: branch || "main",
          userId,
          workspaceId,
          createdAt: new Date(),
        };
        await saveRepository(repoNode);
        logger.log(`Created repository node: ${repository}`);
      }

      // Step 2: Process each file
      const processedFiles: string[] = [];
      const errors: string[] = [];

      for (const file of files) {
        try {
          // Handle special marker for PR files
          if (file.path === "_PR_FILES_" && pr_number) {
            const prFiles = await fetchPRFiles(owner, repo, pr_number, github_token);
            for (const prFile of prFiles) {
              await processFile({
                filePath: prFile.path,
                status: prFile.status as "added" | "modified" | "removed",
                owner,
                repo,
                branch: branch || "main",
                commitSha: commit_sha,
                repoNode,
                userId,
                workspaceId,
                githubToken: github_token,
              });
            }
            continue;
          }

          // Process individual file
          await processFile({
            filePath: file.path,
            status: file.status,
            owner,
            repo,
            branch: branch || "main",
            commitSha: commit_sha,
            repoNode,
            userId,
            workspaceId,
            githubToken: github_token,
          });

          processedFiles.push(file.path);
        } catch (err: any) {
          logger.error(`Error processing file ${file.path}:`, err);
          errors.push(`${file.path}: ${err.message}`);
        }
      }

      logger.log(`Code ingestion completed. Processed: ${processedFiles.length}, Errors: ${errors.length}`);

      return {
        success: true,
        repository,
        processedFiles,
        errors,
        filesProcessed: processedFiles.length,
        errorCount: errors.length,
      };
    } catch (err: any) {
      logger.error(`Error in code ingestion task:`, err);
      return {
        success: false,
        error: err.message,
      };
    }
  },
});

/**
 * Process a single file
 */
async function processFile(params: {
  filePath: string;
  status: "added" | "modified" | "removed";
  owner: string;
  repo: string;
  branch: string;
  commitSha?: string;
  repoNode: RepositoryNode;
  userId: string;
  workspaceId: string;
  githubToken: string;
}) {
  const { filePath, status, owner, repo, branch, commitSha, repoNode, userId, workspaceId, githubToken } = params;

  // Handle file deletion
  if (status === "removed") {
    await markFileDeleted(filePath, userId, workspaceId);
    logger.log(`Marked file as deleted: ${filePath}`);
    return;
  }

  // Fetch file content from GitHub
  const content = await fetchFileContent(owner, repo, filePath, branch, githubToken);

  if (!content) {
    logger.warn(`Could not fetch content for ${filePath}`);
    return;
  }

  // Parse file to AST
  const parseResult = await parseFile(filePath, content);

  if (!parseResult) {
    logger.warn(`Could not parse file: ${filePath}`);
    return;
  }

  const { tree, language } = parseResult;

  // Extract entities
  const entities = extractEntities(tree, content, language);

  logger.log(`Extracted from ${filePath}: ${entities.functions.length} functions, ${entities.classes.length} classes`);

  // Save or update code file node
  const existingFile = await findCodeFileByPath(filePath, userId, workspaceId);
  const fileNode: CodeFileNode = {
    uuid: existingFile?.uuid || crypto.randomUUID(),
    path: filePath,
    language,
    content, // Store content for reference
    commitSha,
    branch,
    userId,
    workspaceId,
    createdAt: existingFile?.createdAt || new Date(),
    modifiedAt: new Date(),
  };

  await saveCodeFile(fileNode);
  await linkRepositoryToFile(repoNode.uuid, fileNode.uuid, userId, workspaceId);

  // If file was modified, mark old functions/classes as deleted
  if (status === "modified" && existingFile) {
    // This is a simplified approach - in production you'd want to do a diff
    // For now, we'll just update entities based on what we extracted
  }

  // Save functions
  for (const func of entities.functions) {
    const existingFunc = await findFunctionByName(func.name, fileNode.uuid, userId, workspaceId);

    const functionNode: FunctionNode = {
      uuid: existingFunc?.uuid || func.uuid,
      name: func.name,
      params: func.params,
      returnType: func.returnType,
      startLine: func.startLine,
      endLine: func.endLine,
      startColumn: func.startColumn,
      endColumn: func.endColumn,
      isAsync: func.isAsync,
      isExport: func.isExport,
      docstring: func.docstring,
      userId,
      workspaceId,
      createdAt: existingFunc?.createdAt || new Date(),
      modifiedAt: new Date(),
    };

    await saveFunction(functionNode);
    await linkFileToFunction(fileNode.uuid, functionNode.uuid, userId, workspaceId);

    // Link AI reviews to this function
    await linkAIReviewsToFunction(filePath, func.startLine, func.endLine, functionNode.uuid, userId, workspaceId);
  }

  // Save classes
  for (const cls of entities.classes) {
    const existingClass = await findClassByName(cls.name, fileNode.uuid, userId, workspaceId);

    const classNode: ClassNode = {
      uuid: existingClass?.uuid || cls.uuid,
      name: cls.name,
      extends: cls.extends,
      implements: cls.implements,
      methods: cls.methods,
      properties: cls.properties,
      startLine: cls.startLine,
      endLine: cls.endLine,
      startColumn: cls.startColumn,
      endColumn: cls.endColumn,
      isExport: cls.isExport,
      docstring: cls.docstring,
      userId,
      workspaceId,
      createdAt: existingClass?.createdAt || new Date(),
      modifiedAt: new Date(),
    };

    await saveClass(classNode);
    await linkFileToClass(fileNode.uuid, classNode.uuid, userId, workspaceId);

    // Link AI reviews to this class
    await linkAIReviewsToClass(filePath, cls.startLine, cls.endLine, classNode.uuid, userId, workspaceId);
  }

  // Link file-level AI reviews
  await linkAIReviewsToFile(filePath, fileNode.uuid, userId, workspaceId);

  logger.log(`Processed file: ${filePath}`);
}

/**
 * Fetch file content from GitHub
 */
async function fetchFileContent(
  owner: string,
  repo: string,
  path: string,
  ref: string,
  token: string
): Promise<string | null> {
  try {
    const url = `https://api.github.com/repos/${owner}/${repo}/contents/${path}?ref=${ref}`;
    const response = await axios.get(url, {
      headers: {
        Authorization: `token ${token}`,
        Accept: "application/vnd.github.v3.raw",
      },
    });

    return response.data;
  } catch (err: any) {
    logger.error(`Failed to fetch file ${path}:`, err.message);
    return null;
  }
}

/**
 * Fetch PR files from GitHub
 */
async function fetchPRFiles(
  owner: string,
  repo: string,
  prNumber: number,
  token: string
): Promise<Array<{ path: string; status: string }>> {
  try {
    const url = `https://api.github.com/repos/${owner}/${repo}/pulls/${prNumber}/files`;
    const response = await axios.get(url, {
      headers: {
        Authorization: `token ${token}`,
        Accept: "application/vnd.github.v3+json",
      },
    });

    return response.data.map((file: any) => ({
      path: file.filename,
      status: file.status,
    }));
  } catch (err: any) {
    logger.error(`Failed to fetch PR files:`, err.message);
    return [];
  }
}

/**
 * Link AI reviews to a file
 */
async function linkAIReviewsToFile(
  filePath: string,
  fileUuid: string,
  userId: string,
  workspaceId: string
) {
  // Find reviews that match this file path with no specific line number
  const reviews = await findReviewsByFileAndLine(filePath, 0, userId, workspaceId);

  for (const review of reviews) {
    await linkReviewToFile(review.uuid, fileUuid, userId, workspaceId);
  }
}

/**
 * Link AI reviews to a function based on line number range
 */
async function linkAIReviewsToFunction(
  filePath: string,
  startLine: number,
  endLine: number,
  functionUuid: string,
  userId: string,
  workspaceId: string
) {
  // Find reviews within the function's line range
  for (let line = startLine; line <= endLine; line++) {
    const reviews = await findReviewsByFileAndLine(filePath, line, userId, workspaceId);

    for (const review of reviews) {
      await linkReviewToFunction(review.uuid, functionUuid, userId, workspaceId);
    }
  }
}

/**
 * Link AI reviews to a class based on line number range
 */
async function linkAIReviewsToClass(
  filePath: string,
  startLine: number,
  endLine: number,
  classUuid: string,
  userId: string,
  workspaceId: string
) {
  // Find reviews within the class's line range
  for (let line = startLine; line <= endLine; line++) {
    const reviews = await findReviewsByFileAndLine(filePath, line, userId, workspaceId);

    for (const review of reviews) {
      await linkReviewToClass(review.uuid, classUuid, userId, workspaceId);
    }
  }
}
