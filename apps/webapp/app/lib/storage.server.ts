import { env } from "~/env.server";
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  type GetObjectCommandInput,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

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
