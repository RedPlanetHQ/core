import { MarkdownViewer } from "./markdown-viewer";
import { CodeViewer } from "./code-viewer";
import { TextViewer } from "./text-viewer";
import { CsvViewer } from "./csv-viewer";
import { OfficeViewer } from "./office-viewer";
import type { ViewerInfo } from "./types";

/**
 * Viewer registry. Add a new viewer by:
 *  1. building the component (props: ViewerComponentProps).
 *  2. registering it here.
 *  3. listing its extensions in EXT_TO_VIEWER.
 *
 * Nothing else in the consumer code needs to change.
 */
export const VIEWERS: ViewerInfo[] = [
  { id: "markdown", label: "Markdown", component: MarkdownViewer },
  { id: "code", label: "Code", component: CodeViewer },
  { id: "text", label: "Text", component: TextViewer },
  { id: "csv", label: "CSV", component: CsvViewer },
  // Office Online viewer for binary office formats (PPTX / DOCX /
  // XLSX). Needs the file's raw URL, not text — skipContentFetch
  // makes the host hand the viewer the path directly.
  {
    id: "office",
    label: "Office document",
    component: OfficeViewer,
    skipContentFetch: true,
  },
];

const VIEWER_BY_ID: Record<string, ViewerInfo> = Object.fromEntries(
  VIEWERS.map((v) => [v.id, v]),
);

/**
 * Extension (lowercase, no leading dot) → viewer id. Lookup falls
 * through to the "text" viewer for any extension not listed here so
 * unknown text-ish files still render rather than failing outright.
 */
const EXT_TO_VIEWER: Record<string, string> = {
  // Markdown
  md: "markdown",
  mdx: "markdown",
  markdown: "markdown",

  // Code — keep listing extensions explicitly so a future "code with
  // highlighting" viewer can swap in without surprising matches.
  ts: "code", tsx: "code", js: "code", jsx: "code", mjs: "code", cjs: "code",
  json: "code", jsonc: "code", json5: "code",
  py: "code", rb: "code", go: "code", rs: "code", java: "code", kt: "code",
  swift: "code", c: "code", h: "code", cpp: "code", hpp: "code", cs: "code",
  php: "code", sh: "code", bash: "code", zsh: "code", fish: "code",
  ps1: "code", bat: "code", cmd: "code",
  html: "code", htm: "code", xml: "code", svg: "code",
  css: "code", scss: "code", sass: "code", less: "code",
  vue: "code", svelte: "code", astro: "code",
  yml: "code", yaml: "code", toml: "code", ini: "code", env: "code",
  lock: "code", gradle: "code", sql: "code", graphql: "code", gql: "code",
  dockerfile: "code", makefile: "code", proto: "code",

  // Plain text
  txt: "text", log: "text", tsv: "text",

  // CSV → dedicated table viewer
  csv: "csv",

  // Office (renderable via Microsoft Office Online iframe)
  pptx: "office",
  docx: "office",
};

/**
 * Extensions we know we *can't* render inline yet — binary formats
 * (images, video, audio, archives, office docs, executables). For
 * these we return null so the host can show "preview not supported"
 * + a download button rather than rendering garbage as text.
 *
 * Image / PDF / Office viewers will land later. Removing an extension
 * from this set + adding a viewer is all that's needed.
 */
const BINARY_EXTENSIONS = new Set<string>([
  // Images
  "png", "jpg", "jpeg", "gif", "webp", "ico", "bmp", "tiff", "tif",
  "heic", "heif", "avif",
  // Video
  "mp4", "mov", "webm", "mkv", "avi", "flv", "wmv", "mpg", "mpeg", "m4v",
  // Audio
  "mp3", "wav", "flac", "ogg", "m4a", "aac", "wma", "opus",
  // Archives
  "zip", "tar", "gz", "tgz", "bz2", "xz", "7z", "rar", "lz", "lzma", "zst",
  // Office / docs (binary). pptx + docx are excluded — handled by
  // OfficeViewer via the MS Office Online iframe, so they fall
  // through to EXT_TO_VIEWER below.
  "pdf", "doc", "xls", "xlsx", "ppt", "odt", "ods", "odp",
  "pages", "numbers", "key", "keynote", "rtf",
  // Executables / libraries / installers
  "exe", "bin", "so", "dll", "dylib", "app", "dmg", "iso", "msi", "pkg",
  "deb", "rpm", "apk", "ipa",
  // DBs / fonts / models / bytecode
  "sqlite", "sqlite3", "db", "parquet",
  "ttf", "otf", "woff", "woff2", "eot",
  "wasm", "class", "jar", "war", "pyc", "pyo",
  "pb", "pt", "onnx", "safetensors", "gguf",
]);

/**
 * Pick the right viewer for a given filename. Returns null for known
 * binary types (so the host can show "preview not supported") and for
 * extensions we explicitly can't render. Unknown extensions fall
 * through to the text viewer so we still try our best for log-like
 * files without a known extension.
 */
export function pickViewer(filename: string): ViewerInfo | null {
  const ext = extOf(filename);
  if (ext && BINARY_EXTENSIONS.has(ext)) return null;

  const id = EXT_TO_VIEWER[ext];
  if (id) return VIEWER_BY_ID[id] ?? null;

  // Match dotfiles + classic Unixy names by basename.
  const lower = filename.toLowerCase();
  if (lower === ".gitignore" || lower === ".npmrc" || lower === ".env") {
    return VIEWER_BY_ID.code ?? null;
  }
  if (lower === "dockerfile" || lower === "makefile" || lower === "readme") {
    return VIEWER_BY_ID.code ?? null;
  }

  return VIEWER_BY_ID.text ?? null;
}

function extOf(name: string): string {
  const i = name.lastIndexOf(".");
  if (i <= 0 || i === name.length - 1) return "";
  return name.slice(i + 1).toLowerCase();
}
