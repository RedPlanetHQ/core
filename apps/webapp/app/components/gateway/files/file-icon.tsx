import {
  Folder,
  FolderOpen,
  FileText,
  FileCode,
  FileImage,
  FileVideo,
  FileAudio,
  FileArchive,
  FileSpreadsheet,
  Presentation,
  Link2,
  File as FileIcon,
} from "lucide-react";
import type { FsEntry } from "~/services/gateway/fs-scripts.server";

const EXT_ICON: Record<string, typeof FileIcon> = {
  // Code
  ts: FileCode, tsx: FileCode, js: FileCode, jsx: FileCode, mjs: FileCode,
  cjs: FileCode, json: FileCode, py: FileCode, rb: FileCode, go: FileCode,
  rs: FileCode, java: FileCode, kt: FileCode, swift: FileCode, c: FileCode,
  h: FileCode, cpp: FileCode, hpp: FileCode, cs: FileCode, php: FileCode,
  sh: FileCode, bash: FileCode, zsh: FileCode, fish: FileCode, html: FileCode,
  css: FileCode, scss: FileCode, sass: FileCode, less: FileCode, vue: FileCode,
  svelte: FileCode, yml: FileCode, yaml: FileCode, toml: FileCode, xml: FileCode,
  // Docs
  md: FileText, mdx: FileText, txt: FileText, rtf: FileText, pdf: FileText,
  // Images
  png: FileImage, jpg: FileImage, jpeg: FileImage, gif: FileImage, webp: FileImage,
  svg: FileImage, ico: FileImage, bmp: FileImage, tiff: FileImage, heic: FileImage,
  // Video
  mp4: FileVideo, mov: FileVideo, webm: FileVideo, mkv: FileVideo, avi: FileVideo,
  // Audio
  mp3: FileAudio, wav: FileAudio, flac: FileAudio, ogg: FileAudio, m4a: FileAudio,
  // Archives
  zip: FileArchive, tar: FileArchive, gz: FileArchive, bz2: FileArchive,
  xz: FileArchive, "7z": FileArchive, rar: FileArchive,
  // Office
  xls: FileSpreadsheet, xlsx: FileSpreadsheet, csv: FileSpreadsheet,
  ppt: Presentation, pptx: Presentation, keynote: Presentation,
  doc: FileText, docx: FileText,
};

function extOf(name: string): string {
  const i = name.lastIndexOf(".");
  if (i <= 0 || i === name.length - 1) return "";
  return name.slice(i + 1).toLowerCase();
}

interface FileIconProps {
  entry: Pick<FsEntry, "name" | "type">;
  size?: number;
  className?: string;
  /** Use the "open" folder variant — e.g. for the breadcrumb's current node. */
  folderOpen?: boolean;
}

export function EntryIcon({
  entry,
  size = 16,
  className,
  folderOpen,
}: FileIconProps) {
  if (entry.type === "dir") {
    const Cmp = folderOpen ? FolderOpen : Folder;
    return <Cmp size={size} className={className} />;
  }
  if (entry.type === "link") {
    return <Link2 size={size} className={className} />;
  }
  const Cmp = EXT_ICON[extOf(entry.name)] ?? FileIcon;
  return <Cmp size={size} className={className} />;
}
