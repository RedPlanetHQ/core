import { env } from "~/env.server";
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  type GetObjectCommandInput,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { logger } from "~/services/logger.service";

const s3Client = new S3Client({
  region: process.env.AWS_REGION || "us-east-1",
  credentials: {
    accessKeyId: env.ACCESS_KEY_ID || "",
    secretAccessKey: env.SECRET_ACCESS_KEY || "",
  },
});

export interface UploadFileResult {
  uuid: string;
  url: string;
}

export async function uploadFileToS3(
  fileBuffer: Buffer,
  fileName: string,
  contentType: string,
  userId: string,
): Promise<UploadFileResult> {
  if (!env.BUCKET) {
    throw new Error("S3 bucket not configured");
  }

  const uuid = crypto.randomUUID();
  const key = `storage/${userId}/${uuid}`;

  const command = new PutObjectCommand({
    Bucket: env.BUCKET,
    Key: key,
    Body: fileBuffer,
    ContentType: contentType,
  });

  await s3Client.send(command);

  // Store metadata for later retrieval
  storeFileMetadata(uuid, fileName, contentType, userId);

  const frontendHost = env.APP_ORIGIN;
  const url = `${frontendHost}/api/v1/storage/${uuid}`;

  return { uuid, url };
}

export async function getFileFromS3(
  uuid: string,
  userId: string,
): Promise<Response> {
  if (!env.BUCKET) {
    throw new Error("S3 bucket not configured");
  }

  const key = `storage/${userId}/${uuid}`;

  const command = new GetObjectCommand({
    Bucket: env.BUCKET,
    Key: key,
  });

  try {
    const response = await s3Client.send(command);

    if (!response.Body) {
      throw new Error("File not found");
    }

    // Convert the response body to a stream
    const stream = response.Body as ReadableStream;

    return new Response(stream, {
      headers: {
        "Content-Type": response.ContentType as string,
        "Content-Length": response.ContentLength?.toString() || "",
        "Cache-Control": "public, max-age=3600",
      },
    });
  } catch (error) {
    throw new Error(`Failed to retrieve file: ${error}`);
  }
}

export async function getSignedUrlForS3(
  uuid: string,
  userId: string,
  expiresIn: number = 3600,
): Promise<string> {
  if (!env.BUCKET) {
    throw new Error("S3 bucket not configured");
  }

  const key = `storage/${userId}/${uuid}`;

  const command: GetObjectCommandInput = {
    Bucket: env.BUCKET,
    Key: key,
  };

  try {
    const signedUrl = await getSignedUrl(
      s3Client,
      new GetObjectCommand(command),
      { expiresIn },
    );
    return signedUrl;
  } catch (error) {
    throw new Error(`Failed to generate signed URL: ${error}`);
  }
}

// Store file metadata for retrieval
interface FileMetadata {
  uuid: string;
  fileName: string;
  contentType: string;
  userId: string;
  uploadedAt: Date;
}

// Simple in-memory storage for file metadata (use database in production)
const fileMetadataStore = new Map<string, FileMetadata>();

export function storeFileMetadata(
  uuid: string,
  fileName: string,
  contentType: string,
  userId: string,
) {
  fileMetadataStore.set(uuid, {
    uuid,
    fileName,
    contentType,
    userId,
    uploadedAt: new Date(),
  });
}

export function getFileMetadata(uuid: string): FileMetadata | undefined {
  return fileMetadataStore.get(uuid);
}

export type StorageSource =
  | { type: 'local'; filePath: string }
  | { type: 's3'; key: string };

/**
 * Download file from S3 as Buffer
 * Reuses existing S3 infrastructure
 */
export async function downloadFromS3AsBuffer(key: string): Promise<Buffer> {
  if (!env.BUCKET) {
    throw new Error('S3 BUCKET not configured');
  }

  const command = new GetObjectCommand({
    Bucket: env.BUCKET,
    Key: key,
  });

  const response = await s3Client.send(command);

  // Convert stream to buffer
  const chunks: Uint8Array[] = [];
  // @ts-ignore - AWS SDK types are complex
  for await (const chunk of response.Body) {
    chunks.push(chunk);
  }

  const buffer = Buffer.concat(chunks);

  logger.info('[Storage] File downloaded from S3', {
    bucket: env.BUCKET,
    key,
    size: buffer.length
  });

  return buffer;
}

/**
 * Save file to temporary local storage
 * Returns the absolute file path
 */
export async function saveToTempStorage(
  fileBuffer: Buffer,
  filename: string
): Promise<string> {
  const fs = await import('fs');
  const path = await import('path');
  const os = await import('os');

  const tempDir = path.join(os.tmpdir(), 'conversation-imports');

  // Create temp directory if it doesn't exist
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }

  const filePath = path.join(tempDir, filename);
  fs.writeFileSync(filePath, fileBuffer);

  logger.info('[Storage] File saved to temp storage', {
    filePath,
    size: fileBuffer.length
  });

  return filePath;
}

/**
 * Delete file from local storage
 */
export async function deleteFromLocalStorage(filePath: string): Promise<void> {
  const fs = await import('fs');

  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
    logger.info('[Storage] File deleted from local storage', { filePath });
  }
}

/**
 * Load file content from storage source
 */
export async function loadFile(source: StorageSource): Promise<string> {
  if (source.type === 's3') {
    const buffer = await downloadFromS3AsBuffer(source.key);
    return buffer.toString('utf-8');
  } else {
    const fs = await import('fs');
    const path = await import('path');

    const fullPath = path.isAbsolute(source.filePath)
      ? source.filePath
      : path.join(process.cwd(), source.filePath);

    if (!fs.existsSync(fullPath)) {
      throw new Error(`File not found: ${fullPath}`);
    }

    return fs.readFileSync(fullPath, 'utf-8');
  }
}

/**
 * Check if S3 is configured
 */
export function isS3Configured(): boolean {
  return Boolean(env.BUCKET);
}

// ====================
// Local Storage Mapping (for open source deployments without S3)
// ====================

/**
 * In-memory storage for mapping UUIDs to local file paths
 * In production with Redis, this should use Redis instead
 * For basic open source deployments, in-memory is sufficient
 */
const localStorageMap = new Map<string, string>();

/**
 * Store file locally and return UUID mapping
 * Used when S3 is not configured (open source deployments)
 */
export async function storeLocalFile(
  buffer: Buffer,
  filename: string,
  userId: string
): Promise<{ uuid: string; filePath: string }> {
  const uuid = crypto.randomUUID();
  const tempPath = await saveToTempStorage(
    buffer,
    `${userId}-${Date.now()}-${filename}`
  );

  localStorageMap.set(uuid, tempPath);

  logger.info('[Storage] File stored locally with UUID mapping', {
    uuid,
    filePath: tempPath,
    size: buffer.length
  });

  return { uuid, filePath: tempPath };
}

/**
 * Get local file path from UUID
 */
export function getLocalFilePath(uuid: string): string | undefined {
  return localStorageMap.get(uuid);
}

/**
 * Delete local file and remove UUID mapping
 */
export async function deleteLocalFile(uuid: string): Promise<void> {
  const filePath = localStorageMap.get(uuid);
  if (filePath) {
    await deleteFromLocalStorage(filePath);
    localStorageMap.delete(uuid);
    logger.info('[Storage] Local file deleted', { uuid, filePath });
  }
}

/**
 * Check if UUID exists in local storage
 */
export function hasLocalFile(uuid: string): boolean {
  return localStorageMap.has(uuid);
}
