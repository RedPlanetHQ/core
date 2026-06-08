/**
 * read_file — load an image or PDF at a URL into the model's context.
 *
 * Scope is intentionally narrow: only `image/*` and `application/pdf`. The
 * tool fetches the URL server-side, base64-encodes the bytes, and returns
 * them as AI SDK v6 tool-result content parts that the underlying provider
 * exposes to the model. Storage proxy URLs (`/api/v1/storage/<uuid>`) are
 * resolved against the active storage driver (S3 or local FS) so they work
 * without auth on the model side.
 *
 * - image/* → `image` content part (model sees the image).
 * - application/pdf → `file` content part (Anthropic native; other providers
 *   may ignore the file part — capability-gate at the caller).
 * - anything else → refused with a short text response.
 */

import { tool, type Tool } from "ai";
import { z } from "zod";
import { getFileBytesFromS3 } from "~/lib/storage.server";
import { logger } from "~/services/logger.service";

const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MB inline cap — must stay in sync with MAX_NATIVE_INLINE_BYTES in file-resolver.server.ts

const STORAGE_URL_RE = /\/api\/v1\/storage\/([0-9a-f-]{36})(?:[/?#]|$)/i;

export function getReadFileTool(userId: string): Tool {
  return tool({
    description:
      "Fetch an image or PDF at the given URL and load it into your context. Supports image/* and application/pdf only — other file types are refused. The URL can be an external https URL or an internal storage URL the user attached. Returns the file inline so you can describe, summarize, or reason about it directly.",
    inputSchema: z.object({
      url: z
        .string()
        .describe(
          "Absolute URL to an image or PDF. Supports https://… and internal /api/v1/storage/<uuid> attachments.",
        ),
      mediaType: z
        .string()
        .optional()
        .describe(
          "Optional media type hint (e.g. 'application/pdf'). If omitted, the Content-Type header is used.",
        ),
    }),
    execute: async ({
      url,
      mediaType: hint,
    }: {
      url: string;
      mediaType?: string;
    }) => {
      try {
        const { data, mediaType, filename, size } = await fetchFile(
          url,
          userId,
          hint,
        );

        const isImage = mediaType.startsWith("image/");
        const isPdf = mediaType === "application/pdf";

        if (!isImage && !isPdf) {
          return {
            content: [
              {
                type: "text",
                text: `Refusing to load ${mediaType}: read_file only supports image/* and application/pdf.`,
              },
            ],
          };
        }

        if (size > MAX_FILE_BYTES) {
          return {
            content: [
              {
                type: "text",
                text: `File at ${url} is too large (${size} bytes, max ${MAX_FILE_BYTES}).`,
              },
            ],
          };
        }

        const base64 = data.toString("base64");

        if (isImage) {
          return {
            content: [
              {
                type: "text",
                text: `Loaded image${filename ? ` ${filename}` : ""} (${mediaType}, ${size} bytes).`,
              },
              { type: "image", data: base64, mediaType },
            ],
          };
        }

        // PDF
        return {
          content: [
            {
              type: "text",
              text: `Loaded PDF${filename ? ` ${filename}` : ""} (${size} bytes). Inline document follows.`,
            },
            {
              type: "file",
              data: base64,
              mediaType,
              ...(filename ? { filename } : {}),
            },
          ],
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.warn("[read_file] failed", { url, error: msg });
        return {
          content: [{ type: "text", text: `Failed to read ${url}: ${msg}` }],
        };
      }
    },
  } as any);
}

async function fetchFile(
  url: string,
  userId: string,
  mediaTypeHint?: string,
): Promise<{
  data: Buffer;
  mediaType: string;
  filename?: string;
  size: number;
}> {
  const proxyMatch = url.match(STORAGE_URL_RE);
  if (proxyMatch) {
    const { data, contentType } = await getFileBytesFromS3(
      proxyMatch[1],
      userId,
    );
    return {
      data,
      mediaType: contentType || mediaTypeHint || "application/octet-stream",
      size: data.length,
    };
  }

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`fetch ${url} failed: ${response.status}`);
  }
  const buf = Buffer.from(await response.arrayBuffer());

  const dispo = response.headers.get("content-disposition") ?? "";
  const filenameMatch = dispo.match(/filename\*?="?([^";]+)"?/i);
  const filename = filenameMatch
    ? decodeURIComponent(filenameMatch[1])
    : undefined;

  return {
    data: buf,
    mediaType:
      response.headers.get("content-type")?.split(";")[0]?.trim() ||
      mediaTypeHint ||
      "application/octet-stream",
    filename,
    size: buf.length,
  };
}
