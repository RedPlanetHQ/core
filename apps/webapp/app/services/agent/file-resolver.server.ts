/**
 * Unified attachment processing.
 *
 * Runs on AIV5 model-format messages produced by Mastra's `convertMessages`.
 * For each user message that carries file content parts:
 *
 *   1. Fetches the bytes server-side (storage proxy URLs go through the
 *      active storage driver; external URLs through generic fetch).
 *   2. **Native types (image/* and application/pdf)**: replaces the part's
 *      `data` field with a Node `Buffer`. Downstream providers
 *      (Anthropic, OpenAI) base64-encode the Buffer themselves and emit
 *      their native image/document blocks. We do NOT hand the provider a
 *      `data:` URI string — that path is broken in @ai-sdk because
 *      `isUrlData` only matches http(s).
 *   3. **Text-extractable types (text/*, application/json, etc.)**: drops
 *      the file part and instead appends the extracted text inside an
 *      `<attachments>` manifest text part on the same message. Inline
 *      text bodies are capped at MAX_INLINE_TEXT_BYTES.
 *   4. **Unsupported binary types** (docx, xlsx, etc.): doesn't fetch
 *      bytes — drops the file part and lists it in the manifest as
 *      `status="unsupported"`. The model can call `read_file` on the URL
 *      if it wants to try image/pdf decoding, or decline politely.
 *
 * Every processed message that had attachments ends with a single
 * `<attachments>` text part listing all of them. Native ones are listed
 * with `status="inlined"` (their bytes are already a sibling native part),
 * extracted ones inline their text, unsupported ones are listed by URL.
 * The block also nudges the agent to call `read_file` for any URL it
 * encounters outside the manifest.
 */

import { getFileBytes } from "~/lib/storage.server";
import { logger } from "~/services/logger.service";

const STORAGE_URL_RE = /\/api\/v1\/storage\/([0-9a-f-]{36})(?:[/?#]|$)/i;

const MAX_INLINE_TEXT_BYTES = 100 * 1024; // 100 KB cap on inlined text bodies
const MAX_NATIVE_INLINE_BYTES = 10 * 1024 * 1024; // 10 MB cap on inlined image/PDF bytes

type AttachmentEntry =
  | {
      kind: "native";
      filename?: string;
      mediaType: string;
      url?: string;
    }
  | {
      kind: "extracted-text";
      filename?: string;
      mediaType: string;
      url?: string;
      text: string;
      truncated: boolean;
      originalBytes: number;
    }
  | {
      kind: "unsupported";
      filename?: string;
      mediaType: string;
      url?: string;
    }
  | {
      kind: "too-large";
      filename?: string;
      mediaType: string;
      url?: string;
      bytes: number;
      limit: number;
    };

export async function processFileAttachments<T>(
  modelMessages: T,
  userId: string,
): Promise<T> {
  if (!Array.isArray(modelMessages)) return modelMessages;

  const out: unknown[] = [];
  for (const msg of modelMessages) {
    if (!msg || typeof msg !== "object") {
      out.push(msg);
      continue;
    }
    const m = msg as { content?: unknown };
    if (!Array.isArray(m.content)) {
      out.push(msg);
      continue;
    }

    const newContent: unknown[] = [];
    const manifest: AttachmentEntry[] = [];

    for (const part of m.content) {
      if (!part || typeof part !== "object") {
        newContent.push(part);
        continue;
      }
      const p = part as {
        type?: unknown;
        data?: unknown;
        mediaType?: unknown;
        filename?: unknown;
      };

      if (p.type !== "file") {
        newContent.push(part);
        continue;
      }

      const filename =
        typeof p.filename === "string" ? p.filename : undefined;
      const declaredMediaType =
        typeof p.mediaType === "string" ? p.mediaType : undefined;

      // Data is already raw bytes — leave alone, just record in manifest.
      if (p.data instanceof Uint8Array) {
        newContent.push(part);
        manifest.push({
          kind: "native",
          filename,
          mediaType: declaredMediaType ?? "application/octet-stream",
        });
        continue;
      }

      const urlString =
        p.data instanceof URL
          ? p.data.toString()
          : typeof p.data === "string"
            ? p.data
            : null;

      if (!urlString) {
        // Unknown shape — leave it alone.
        newContent.push(part);
        continue;
      }

      // For unsupported binary types we don't even fetch — short-circuit on
      // the declared media type when it's already clearly non-native and
      // non-text. (Falls through to the full fetch path otherwise so we can
      // sniff the response Content-Type.)
      if (
        declaredMediaType &&
        !isNative(declaredMediaType) &&
        !isTextExtractable(declaredMediaType)
      ) {
        manifest.push({
          kind: "unsupported",
          filename,
          mediaType: declaredMediaType,
          url: urlString,
        });
        continue;
      }

      let bytes: Buffer;
      let mediaType: string;
      try {
        const fetched = await fetchBytes(urlString, userId, declaredMediaType);
        bytes = fetched.data;
        mediaType = fetched.mediaType;
      } catch (err) {
        logger.warn("[file-resolver] failed to fetch attachment", {
          url: urlString,
          error: err instanceof Error ? err.message : String(err),
        });
        manifest.push({
          kind: "unsupported",
          filename,
          mediaType: declaredMediaType ?? "application/octet-stream",
          url: urlString,
        });
        continue;
      }

      if (isNative(mediaType)) {
        if (bytes.length > MAX_NATIVE_INLINE_BYTES) {
          // Don't blow the context — list it but don't inline.
          manifest.push({
            kind: "too-large",
            filename,
            mediaType,
            url: urlString,
            bytes: bytes.length,
            limit: MAX_NATIVE_INLINE_BYTES,
          });
          continue;
        }
        newContent.push({
          ...(part as object),
          data: bytes,
          mediaType,
        });
        manifest.push({ kind: "native", filename, mediaType, url: urlString });
        continue;
      }

      if (isTextExtractable(mediaType)) {
        const truncated = bytes.length > MAX_INLINE_TEXT_BYTES;
        const slice = truncated ? bytes.subarray(0, MAX_INLINE_TEXT_BYTES) : bytes;
        manifest.push({
          kind: "extracted-text",
          filename,
          mediaType,
          url: urlString,
          text: slice.toString("utf8"),
          truncated,
          originalBytes: bytes.length,
        });
        continue;
      }

      manifest.push({
        kind: "unsupported",
        filename,
        mediaType,
        url: urlString,
      });
    }

    if (manifest.length > 0) {
      newContent.push({
        type: "text",
        text: renderAttachmentsBlock(manifest),
      });
    }

    out.push({ ...(msg as object), content: newContent });
  }

  return out as T;
}

function isNative(mediaType: string): boolean {
  return (
    mediaType.startsWith("image/") || mediaType === "application/pdf"
  );
}

function isTextExtractable(mediaType: string): boolean {
  if (mediaType.startsWith("text/")) return true;
  if (mediaType === "application/json") return true;
  if (mediaType === "application/xml") return true;
  if (mediaType === "application/x-yaml" || mediaType === "text/yaml") {
    return true;
  }
  return false;
}

function renderAttachmentsBlock(entries: AttachmentEntry[]): string {
  const lines: string[] = ["<attachments>"];
  for (const e of entries) {
    const attrs = [
      e.filename ? `filename="${escapeAttr(e.filename)}"` : null,
      `mediaType="${escapeAttr(e.mediaType)}"`,
      e.url ? `url="${escapeAttr(e.url)}"` : null,
    ]
      .filter(Boolean)
      .join(" ");

    if (e.kind === "extracted-text") {
      const note = e.truncated
        ? ` truncated="true" originalBytes="${e.originalBytes}"`
        : "";
      lines.push(`  <attachment ${attrs}${note}>`);
      lines.push(e.text);
      lines.push("  </attachment>");
    } else if (e.kind === "native") {
      lines.push(`  <attachment ${attrs} status="inlined" />`);
    } else if (e.kind === "too-large") {
      lines.push(
        `  <attachment ${attrs} status="too-large" bytes="${e.bytes}" limit="${e.limit}" />`,
      );
    } else {
      lines.push(`  <attachment ${attrs} status="unsupported" />`);
    }
  }
  lines.push("</attachments>");
  lines.push(
    "If you need to read a file at a URL that isn't already inlined above, call the read_file tool with that URL.",
  );
  return lines.join("\n");
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

async function fetchBytes(
  url: string,
  userId: string,
  mediaTypeHint?: string,
): Promise<{ data: Buffer; mediaType: string }> {
  const proxyMatch = url.match(STORAGE_URL_RE);
  if (proxyMatch) {
    const { data, contentType } = await getFileBytes(proxyMatch[1], userId);
    return {
      data,
      mediaType: contentType || mediaTypeHint || "application/octet-stream",
    };
  }

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`fetch ${url} failed: ${response.status}`);
  }
  const buf = Buffer.from(await response.arrayBuffer());
  return {
    data: buf,
    mediaType:
      response.headers.get("content-type")?.split(";")[0]?.trim() ||
      mediaTypeHint ||
      "application/octet-stream",
  };
}
