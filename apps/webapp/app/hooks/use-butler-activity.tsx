import { useEffect, useState } from "react";
import { useFetcher } from "@remix-run/react";
import type { ButlerActivitySummary } from "~/services/butler-activity.server";

const POLL_INTERVAL_MS = 5000;

export function useButlerActivity() {
  const fetcher = useFetcher<ButlerActivitySummary>();
  const [intervalId, setIntervalId] = useState<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (fetcher.state === "idle" && !fetcher.data) {
      fetcher.load("/api/v1/butler-status");
    }
  }, [fetcher]);

  useEffect(() => {
    if (intervalId || !fetcher.data?.active) return;

    const interval = setInterval(() => {
      if (fetcher.state === "idle") {
        fetcher.load("/api/v1/butler-status");
      }
    }, POLL_INTERVAL_MS);

    setIntervalId(interval);

    return () => clearInterval(interval);
  }, [fetcher, intervalId]);

  useEffect(() => {
    if (fetcher.data?.active !== false || !intervalId) return;

    clearInterval(intervalId);
    setIntervalId(null);
  }, [fetcher.data?.active, intervalId]);

  useEffect(() => {
    return () => {
      if (intervalId) clearInterval(intervalId);
    };
  }, [intervalId]);

  return {
    data: fetcher.data,
    isLoading: fetcher.state === "loading" && !fetcher.data,
  };
}
