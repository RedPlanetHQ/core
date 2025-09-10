import { useEffect, useState, useCallback } from "react";
import { useFetcher } from "@remix-run/react";

export interface LogItem {
  id: string;
  source: string;
  ingestText: string;
  time: string;
  processedAt?: string;
  status: "PENDING" | "PROCESSING" | "COMPLETED" | "FAILED" | "CANCELLED";
  error?: string;
  sourceURL?: string;
  type?: string;
  integrationSlug?: string;
  activityId?: string;
  episodeUUID?: string;
  data?: any;
}

export interface LogsResponse {
  logs: LogItem[];
  totalCount: number;
  page: number;
  limit: number;
  hasMore: boolean;
  availableSources: Array<{ name: string; slug: string }>;
}

export interface UseLogsOptions {
  endpoint: string; // '/api/v1/logs/all' or '/api/v1/logs/activity'
  source?: string;
  status?: string;
}

export function useLogs({ endpoint, source, status }: UseLogsOptions) {
  const fetcher = useFetcher<LogsResponse>();
  const [logs, setLogs] = useState<LogItem[]>([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [availableSources, setAvailableSources] = useState<
    Array<{ name: string; slug: string }>
  >([]);
  const [isInitialLoad, setIsInitialLoad] = useState(true);

  const buildUrl = useCallback(
    (pageNum: number) => {
      const params = new URLSearchParams();
      params.set("page", pageNum.toString());
      params.set("limit", "5");
      if (source) params.set("source", source);
      if (status) params.set("status", status);
      return `${endpoint}?${params.toString()}`;
    },
    [endpoint, source, status],
  );

  const loadMore = useCallback(() => {
    if (fetcher.state === "idle" && hasMore) {
      fetcher.load(buildUrl(page + 1));
    }
  }, [hasMore, page, buildUrl]);

  const reset = useCallback(() => {
    setLogs([]);
    setPage(1);
    setHasMore(true);
    setIsInitialLoad(true);
    fetcher.load(buildUrl(1));
  }, [buildUrl]);

  // Effect to handle fetcher data
  useEffect(() => {
    if (fetcher.data) {
      const {
        logs: newLogs,
        hasMore: newHasMore,
        page: currentPage,
        availableSources: sources,
      } = fetcher.data;

      if (currentPage === 1) {
        // First page or reset
        setLogs(newLogs);
        setIsInitialLoad(false);
      } else {
        // Append to existing logs
        setLogs((prev) => [...prev, ...newLogs]);
      }

      setHasMore(newHasMore);
      setPage(currentPage);
      setAvailableSources(sources);
    }
  }, [fetcher.data]);

  // Effect to reset when filters change
  useEffect(() => {
    setLogs([]);
    setPage(1);
    setHasMore(true);
    setIsInitialLoad(true);
    fetcher.load(buildUrl(1));
  }, [source, status, buildUrl]); // Inline reset logic to avoid dependency issues

  // Initial load
  useEffect(() => {
    if (isInitialLoad) {
      fetcher.load(buildUrl(1));
    }
  }, [isInitialLoad, buildUrl]);

  return {
    logs,
    hasMore,
    loadMore,
    reset,
    availableSources,
    isLoading: fetcher.state === "loading",
    isInitialLoad,
  };
}
