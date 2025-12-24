import { useEffect, useState, useCallback } from "react";
import { useFetcher } from "@remix-run/react";

export interface DocumentItem {
  id: string;
  source: string;
  title?: string;
  content: string;
  labelIds: string[];
  createdAt: string;
  processedAt?: string;
  type: string;
  status: string;
  error?: string;
  latestIngestionLog: {
    status: string;
  };
}

export interface DocumentsResponse {
  documents: DocumentItem[];
  page: number;
  limit: number;
  hasMore: boolean;
  nextCursor?: string | null;
  availableSources?: Array<{ name: string; slug: string }>;
}

export interface UseDocumentsOptions {
  endpoint: string;
  source?: string;
  status?: string;
  type?: string;
  label?: string;
}

export function useDocuments({
  endpoint,
  source,
  status,
  type,
  label,
}: UseDocumentsOptions) {
  const fetcher = useFetcher<DocumentsResponse>();
  const [documents, setDocuments] = useState<DocumentItem[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [availableSources, setAvailableSources] = useState<
    Array<{ name: string; slug: string }>
  >([]);
  const [isInitialLoad, setIsInitialLoad] = useState(true);

  const buildUrl = useCallback(
    (cursorValue: string | null) => {
      const params = new URLSearchParams();
      params.set("limit", "50");
      if (cursorValue) params.set("cursor", cursorValue);
      if (source) params.set("source", source);
      if (status) params.set("status", status);
      if (type) params.set("type", type);
      if (label) params.set("label", label);
      return `${endpoint}?${params.toString()}`;
    },
    [endpoint, source, status, type, label],
  );

  const loadMore = useCallback(() => {
    // Only load more if we have a cursor (from previous page)
    if (fetcher.state === "idle" && hasMore && cursor) {
      fetcher.load(buildUrl(cursor));
    }
  }, [hasMore, cursor, buildUrl]);

  const reset = useCallback(() => {
    setDocuments([]);
    setCursor(null);
    setHasMore(true);
    setIsInitialLoad(true);
    fetcher.load(buildUrl(null));
  }, [buildUrl]);

  // Effect to handle fetcher data
  useEffect(() => {
    if (fetcher.data) {
      const {
        documents: newLogs,
        hasMore: newHasMore,
        nextCursor,
        availableSources: apiSources,
      } = fetcher.data;

      // Check if we're resetting (no cursor and no existing logs)
      const isReset = cursor === null && documents.length === 0;

      if (isReset) {
        // First page or reset
        setDocuments(newLogs);
        setIsInitialLoad(false);
      } else if (nextCursor !== cursor) {
        // Only append if we got a new cursor (new page)
        setDocuments((prev) => [...prev, ...newLogs]);
      }

      setHasMore(newHasMore);
      setCursor(nextCursor || null);

      // Use available sources from API response
      if (apiSources) {
        setAvailableSources(apiSources);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetcher.data]);

  // Effect to reset when filters change
  useEffect(() => {
    setDocuments([]);
    setCursor(null);
    setHasMore(true);
    setIsInitialLoad(true);
    fetcher.load(buildUrl(null));
  }, [source, status, type, label, buildUrl]); // Inline reset logic to avoid dependency issues

  // Initial load
  useEffect(() => {
    if (isInitialLoad) {
      fetcher.load(buildUrl(null));
    }
  }, [isInitialLoad, buildUrl]);

  return {
    documents,
    hasMore,
    loadMore,
    reset,
    availableSources,
    isLoading: fetcher.state === "loading",
    isInitialLoad,
  };
}
