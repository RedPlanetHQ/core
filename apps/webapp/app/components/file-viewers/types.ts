import type { ComponentType } from "react";

/**
 * Reusable file-viewer component contract. Drop a `<FileViewer
 * gatewayId path />` anywhere — gateway Files tab, chat, task drawer —
 * and the host fetches contents and renders the right viewer for that
 * extension.
 */
export interface FileViewerProps {
  gatewayId: string;
  /** Absolute path on the gateway (must be inside an `exec`-scoped folder). */
  path: string;
  className?: string;
  /**
   * Optional cap for bytes to fetch. Server enforces its own hard cap
   * (see READ_DEFAULT_CAP in fs-scripts.server.ts) so this only
   * narrows the request, never widens it.
   */
  maxBytes?: number;
}

export interface FileContent {
  text: string;
  truncated: boolean;
  totalBytes: number;
  readBytes: number;
}

export interface ViewerComponentProps {
  gatewayId: string;
  path: string;
  /**
   * Text content fetched via `/fs/read`. Optional because some viewers
   * (binary formats like PPTX) opt out of the text fetch with
   * `skipContentFetch` and fetch their own bytes via `/fs/download`.
   */
  content?: FileContent;
  className?: string;
}

export interface ViewerInfo {
  id: string;
  label: string;
  component: ComponentType<ViewerComponentProps>;
  /**
   * Tell the host to skip the text `/fs/read` fetch and just mount the
   * component — used for binary viewers (PPTX, PDF, images) that need
   * the raw bytes and grab them themselves.
   */
  skipContentFetch?: boolean;
}
