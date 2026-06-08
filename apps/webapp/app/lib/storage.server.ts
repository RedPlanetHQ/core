/**
 * File storage abstraction.
 *
 * Two drivers:
 *  - `s3`    — uploads/reads against AWS S3 (or any S3-compatible bucket).
 *              Used when `STORAGE_DRIVER=s3` or when `BUCKET` is set and
 *              `STORAGE_DRIVER` is unset.
 *  - `local` — writes files to a directory on the server filesystem
 *              (default `./data/storage`, override with `STORAGE_DIR`).
 *              Used when `STORAGE_DRIVER=local` or when no S3 bucket is
 *              configured.
 *
 * Both drivers return the same `${APP_ORIGIN}/api/v1/storage/<uuid>` URL
 * shape so client code, attachments persisted in conversation history,
 * and the auth-protected `GET /api/v1/storage/:uuid` route work
 * identically regardless of driver.
 */

import { promises as fs } from "node:fs";
import path from "node:path";

import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
} from "@aws-sdk/client-s3";

import { env } from "~/env.server";

// ─── Driver selection ──────────────────────────────────────────────

type Driver = "s3" | "local";

function resolveDriver(): Driver {
  if (env.STORAGE_DRIVER) return env.STORAGE_DRIVER as Driver;
  return env.BUCKET ? "s3" : "local";
}

const driver: Driver = resolveDriver();

function localBaseDir(): string {
  return env.STORAGE_DIR
    ? path.resolve(env.STORAGE_DIR)
    : path.resolve(process.cwd(), "data", "storage");
}

// S3 client is lazy — only constructed if we need it.
let s3ClientSingleton: S3Client | null = null;
function getS3Client(): S3Client {
  if (s3ClientSingleton) return s3ClientSingleton;
  s3ClientSingleton = new S3Client({
    region: process.env.AWS_REGION || "us-east-1",
    credentials: {
      accessKeyId: env.ACCESS_KEY_ID || "",
      secretAccessKey: env.SECRET_ACCESS_KEY || "",
    },
  });
  return s3ClientSingleton;
}

// ─── Public API ────────────────────────────────────────────────────

export interface UploadFileResult {
  uuid: string;
  url: string;
}

export async function uploadFile(
  fileBuffer: Buffer,
  fileName: string,
  contentType: string,
  userId: string,
): Promise<UploadFileResult> {
  const uuid = crypto.randomUUID();

  if (driver === "s3") {
    if (!env.BUCKET) {
      throw new Error(
        "Storage driver is 's3' but BUCKET is not set. Set STORAGE_DRIVER=local to use filesystem storage.",
      );
    }
    const key = `storage/${userId}/${uuid}`;
    await getS3Client().send(
      new PutObjectCommand({
        Bucket: env.BUCKET,
        Key: key,
        Body: fileBuffer,
        ContentType: contentType,
      }),
    );
  } else {
    const dir = path.join(localBaseDir(), userId);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, uuid), fileBuffer);
    await fs.writeFile(
      path.join(dir, `${uuid}.meta.json`),
      JSON.stringify({ fileName, contentType, uploadedAt: Date.now() }),
    );
  }

  storeFileMetadata(uuid, fileName, contentType, userId);

  const url = `${env.APP_ORIGIN}/api/v1/storage/${uuid}`;
  return { uuid, url };
}

export async function getFile(
  uuid: string,
  userId: string,
): Promise<Response> {
  const { data, contentType } = await getFileBytes(uuid, userId);
  return new Response(data, {
    headers: {
      "Content-Type": contentType,
      "Content-Length": data.length.toString(),
      "Cache-Control": "private, max-age=3600",
    },
  });
}

export async function getFileBytes(
  uuid: string,
  userId: string,
): Promise<{ data: Buffer; contentType: string }> {
  if (driver === "s3") {
    if (!env.BUCKET) {
      throw new Error("Storage driver is 's3' but BUCKET is not set.");
    }
    const key = `storage/${userId}/${uuid}`;
    const response = await getS3Client().send(
      new GetObjectCommand({ Bucket: env.BUCKET, Key: key }),
    );
    if (!response.Body) throw new Error("File not found");
    const bytes = await (
      response.Body as { transformToByteArray: () => Promise<Uint8Array> }
    ).transformToByteArray();
    return {
      data: Buffer.from(bytes),
      contentType: response.ContentType ?? "application/octet-stream",
    };
  }

  const filePath = path.join(localBaseDir(), userId, uuid);
  const metaPath = `${filePath}.meta.json`;
  let contentType = "application/octet-stream";
  try {
    const metaRaw = await fs.readFile(metaPath, "utf8");
    const meta = JSON.parse(metaRaw) as { contentType?: string };
    if (meta.contentType) contentType = meta.contentType;
  } catch {
    // metadata missing — fall back to octet-stream
  }
  const data = await fs.readFile(filePath);
  return { data, contentType };
}

// ─── Back-compat aliases ───────────────────────────────────────────
// Old call sites still import the S3-suffixed names. Keep them working.

export const uploadFileToS3 = uploadFile;
export const getFileFromS3 = getFile;
export const getFileBytesFromS3 = getFileBytes;

// ─── File metadata (in-memory; survives only for the active process) ──

interface FileMetadata {
  uuid: string;
  fileName: string;
  contentType: string;
  userId: string;
  uploadedAt: Date;
}

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

export function getStorageDriver(): Driver {
  return driver;
}
