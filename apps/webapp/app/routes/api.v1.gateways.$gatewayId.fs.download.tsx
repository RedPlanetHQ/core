import { type LoaderFunctionArgs } from "@remix-run/node";
import path from "node:path";
import { prisma } from "~/db.server";
import { requireUser, getWorkspaceId } from "~/services/session.server";
import { callTool } from "~/services/gateway/transport.server";
import {
  DOWNLOAD_CHUNK_BYTES,
  DOWNLOAD_MAX_BYTES,
  READ_CHUNK_SCRIPT,
  shEsc,
} from "~/services/gateway/fs-scripts.server";

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

/**
 * GET /api/v1/gateways/:gatewayId/fs/download?path=<absolute>
 *
 * Reads a file from the gateway in chunks (each well under the
 * exec_command stdout cap), assembles the bytes, and returns the
 * file as an attachment download. v1 limits total size to 10 MB to
 * avoid runaway round-trips — for very large files we'll want a
 * proper streaming transport later.
 */
export async function loader({ request, params }: LoaderFunctionArgs) {
  const { gatewayId } = params;
  if (!gatewayId) return new Response("Missing gatewayId", { status: 400 });

  const user = await requireUser(request);
  const workspaceId = (await getWorkspaceId(
    request,
    user.id,
    user.workspaceId,
  )) as string;

  const gw = await prisma.gateway.findFirst({
    where: { id: gatewayId, workspaceId },
    select: { id: true },
  });
  if (!gw) return new Response("Gateway not found", { status: 404 });

  const url = new URL(request.url);
  const target = url.searchParams.get("path");
  if (!target) return new Response("Missing path", { status: 400 });

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
      return new Response(
        err instanceof Error ? err.message : String(err),
        { status: 502 },
      );
    }

    if (result.exitCode !== 0) {
      return new Response(result.stderr?.trim() || `exited ${result.exitCode}`, {
        status: 502,
      });
    }

    let payload: ChunkPayload;
    try {
      payload = JSON.parse(result.stdout) as ChunkPayload;
    } catch {
      return new Response("Gateway returned invalid chunk JSON", {
        status: 502,
      });
    }

    if (totalBytes < 0) {
      totalBytes = payload.totalBytes;
      if (totalBytes > DOWNLOAD_MAX_BYTES) {
        return new Response(
          `File too large to download (${totalBytes} bytes > ${DOWNLOAD_MAX_BYTES} cap)`,
          { status: 413 },
        );
      }
    }

    if (payload.bytesRead > 0) {
      chunks.push(Buffer.from(payload.data, "base64"));
      offset += payload.bytesRead;
    }
    if (payload.eof || payload.bytesRead === 0) break;
  }

  const body = Buffer.concat(chunks);
  const filename = path.basename(target);
  // RFC 5987 filename* with UTF-8 — handles unicode filenames cleanly.
  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": contentTypeFor(filename),
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
      "Content-Length": String(body.length),
      "Cache-Control": "no-store",
    },
  });
}

/** Best-effort MIME guess from extension. Falls back to octet-stream. */
function contentTypeFor(filename: string): string {
  const ext = filename.toLowerCase().split(".").pop() ?? "";
  const MAP: Record<string, string> = {
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
  return MAP[ext] ?? "application/octet-stream";
}

