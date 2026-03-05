import { useEffect, useState } from "react";
import { useFetcher } from "@remix-run/react";

export interface IngestionQueueItem {
  id: string;
  status: "PENDING" | "PROCESSING" | "COMPLETED" | "FAILED" | "CANCELLED";
  createdAt: string;
  error?: string;
  data: any;
}

export interface FailedIngestionQueueItem extends IngestionQueueItem {
  sessionId: string | null;
  documentId: string | null;
}

export interface IngestionStatusResponse {
  queue: IngestionQueueItem[];
  count: number;
  failedQueue: FailedIngestionQueueItem[];
  failedCount: number;
}

export function useIngestionStatus() {
  const fetcher = useFetcher<IngestionStatusResponse>();
  const [isPolling, setIsPolling] = useState(false);
  const [intervalId, setIntervalId] = useState<NodeJS.Timeout | null>(null);

  const hasActiveRecords = (data: IngestionStatusResponse | undefined) => {
    if (!data || !data.queue) return false;
    return data.queue.some(item => item.status === "PROCESSING" || item.status === "PENDING");
  };

  const startPolling = () => {
    if (intervalId) return; // Already polling
    
    const pollIngestionStatus = () => {
      if (fetcher.state === "idle") {
        fetcher.load("/api/v1/ingestion-queue/status");
      }
    };

    const interval = setInterval(pollIngestionStatus, 3000); // Poll every 3 seconds
    setIntervalId(interval);
    setIsPolling(true);
  };

  const stopPolling = () => {
    if (intervalId) {
      clearInterval(intervalId);
      setIntervalId(null);
      setIsPolling(false);
    }
  };

  useEffect(() => {
    // Initial load to check if we need to start polling
    if (fetcher.state === "idle" && !fetcher.data) {
      fetcher.load("/api/v1/ingestion-queue/status");
    }
  }, []);

  useEffect(() => {
    if (fetcher.data) {
      const activeRecords = hasActiveRecords(fetcher.data);
      
      if (activeRecords && !isPolling) {
        // Start polling if we have active records and aren't already polling
        startPolling();
      } else if (!activeRecords && isPolling) {
        // Stop polling if no active records and we're currently polling
        stopPolling();
      }
    }
  }, [fetcher.data, isPolling]);

  useEffect(() => {
    return () => {
      stopPolling();
    };
  }, []);

  return {
    data: fetcher.data,
    isLoading: fetcher.state === "loading",
    isPolling,
    error: fetcher.data === undefined && fetcher.state === "idle" ? "Error loading ingestion status" : null
  };
}
