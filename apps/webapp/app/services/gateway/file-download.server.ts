/**
 * Chunked file download from a connected gateway, assembled into a
 * single Buffer for the webapp to serve. The transport is the
 * existing `exec_command` tool — we ship `READ_CHUNK_SCRIPT` (a Node
 * one-liner) and loop offsets until EOF. Each chunk stays under the
 * gateway's 128 KB stdout cap.
 *
 * Used by both `/fs/download` (attachment, session-gated) and
 * `/fs/signed/:token` (inline, signed-URL public), so neither route
 * has to duplicate the chunk loop or the error handling.
 */

import path from "node:path";
import { callTool } from "./transport.server";
import {
  DOWNLOAD_CHUNK_BYTES,
  DOWNLOAD_MAX_BYTES,
  READ_CHUNK_SCRIPT,
  shEsc,
} from "./fs-scripts.server";

interface ExecToolResult {
  command: string;
  dir: string;
  exitCode: number;
  stdout: string;
  stderr?: string;
}

interface ChunkPayload {
  data: string;
  bytesRead: number;
  totalBytes: number;
  eof: boolean;
}

export class GatewayDownloadError extends Error {
  /** HTTP status the caller should respond with (best-effort mapping). */
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export interface GatewayDownloadResult {
  body: Buffer;
  totalBytes: number;
}

/**
 * Pull a file off a connected gateway. Throws `GatewayDownloadError`
 * with a usable HTTP status on any failure (file too large, gateway
 * unreachable, exec failure, malformed payload).
 */
export async function downloadGatewayFile(
  gatewayId: string,
  target: string,
): Promise<GatewayDownloadResult> {
  const dir = path.dirname(target);
  const chunks: Buffer[] = [];
  let offset = 0;
  let totalBytes = -1;

  while (true) {
    const command = `node -e ${shEsc(READ_CHUNK_SCRIPT)} ${shEsc(target)} ${offset} ${DOWNLOAD_CHUNK_BYTES}`;

    let result: ExecToolResult;
    try {
      result = (await callTool(gatewayId, "exec_command", {
        command,
        dir,
      })) as ExecToolResult;
    } catch (err) {
      throw new GatewayDownloadError(
        err instanceof Error ? err.message : String(err),
        502,
      );
    }

    if (result.exitCode !== 0) {
      throw new GatewayDownloadError(
        result.stderr?.trim() || `exited ${result.exitCode}`,
        502,
      );
    }

    let payload: ChunkPayload;
    try {
      payload = JSON.parse(result.stdout) as ChunkPayload;
    } catch {
      throw new GatewayDownloadError(
        "Gateway returned invalid chunk JSON",
        502,
      );
    }

    if (totalBytes < 0) {
      totalBytes = payload.totalBytes;
      if (totalBytes > DOWNLOAD_MAX_BYTES) {
        throw new GatewayDownloadError(
          `File too large to download (${totalBytes} bytes > ${DOWNLOAD_MAX_BYTES} cap)`,
          413,
        );
      }
    }

    if (payload.bytesRead > 0) {
      chunks.push(Buffer.from(payload.data, "base64"));
      offset += payload.bytesRead;
    }
    if (payload.eof || payload.bytesRead === 0) break;
  }

  return { body: Buffer.concat(chunks), totalBytes };
}

/** Best-effort MIME guess from filename extension. */
export function contentTypeForFilename(filename: string): string {
  const ext = filename.toLowerCase().split(".").pop() ?? "";
  return EXT_TO_MIME[ext] ?? "application/octet-stream";
}

const EXT_TO_MIME: Record<string, string> = {
  md: "text/markdown",
  mdx: "text/markdown",
  txt: "text/plain",
  log: "text/plain",
  csv: "text/csv",
  tsv: "text/tab-separated-values",
  json: "application/json",
  yml: "application/yaml",
  yaml: "application/yaml",
  toml: "application/toml",
  xml: "application/xml",
  html: "text/html",
  htm: "text/html",
  css: "text/css",
  js: "application/javascript",
  mjs: "application/javascript",
  cjs: "application/javascript",
  ts: "application/typescript",
  tsx: "application/typescript",
  jsx: "application/javascript",
  py: "text/x-python",
  rb: "text/x-ruby",
  go: "text/x-go",
  rs: "text/x-rust",
  java: "text/x-java",
  c: "text/x-c",
  h: "text/x-c",
  cpp: "text/x-c++",
  hpp: "text/x-c++",
  cs: "text/x-csharp",
  sh: "application/x-sh",
  sql: "application/sql",
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  ico: "image/x-icon",
  mp4: "video/mp4",
  webm: "video/webm",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  zip: "application/zip",
  tar: "application/x-tar",
  gz: "application/gzip",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};
