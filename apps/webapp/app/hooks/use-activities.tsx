import { useEffect, useState, useCallback } from "react";
import { useFetcher } from "@remix-run/react";

export interface ActivityItem {
  id: string;
  text: string;
  sourceURL?: string | null;
  createdAt: string;
  integrationAccount?: {
    integrationDefinition?: {
      name: string;
      slug: string;
      icon: string;
    } | null;
  } | null;
}

export interface ActivitiesResponse {
  activities: ActivityItem[];
  hasMore: boolean;
  nextCursor?: string | null;
  availableSources?: Array<{ name: string; slug: string; icon: string }>;
}

export interface UseActivitiesOptions {
  endpoint: string;
  source?: string;
}

export function useActivities({ endpoint, source }: UseActivitiesOptions) {
  const fetcher = useFetcher<ActivitiesResponse>();
  const [activities, setActivities] = useState<ActivityItem[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [availableSources, setAvailableSources] = useState<
    Array<{ name: string; slug: string; icon: string }>
  >([]);
  const [isInitialLoad, setIsInitialLoad] = useState(true);

  const buildUrl = useCallback(
    (cursorValue: string | null) => {
      const params = new URLSearchParams();
      params.set("limit", "25");
      if (cursorValue) params.set("cursor", cursorValue);
      if (source) params.set("source", source);
      return `${endpoint}?${params.toString()}`;
    },
    [endpoint, source],
  );

  const loadMore = useCallback(() => {
    if (fetcher.state === "idle" && hasMore && cursor) {
      fetcher.load(buildUrl(cursor));
    }
  }, [hasMore, cursor, buildUrl, fetcher]);

  // Handle fetcher data
  useEffect(() => {
    if (fetcher.data) {
      const {
        activities: newActivities,
        hasMore: newHasMore,
        nextCursor,
        availableSources: apiSources,
      } = fetcher.data;

      const isReset = cursor === null && activities.length === 0;

      if (isReset) {
        setActivities(newActivities);
        setIsInitialLoad(false);
      } else if (nextCursor !== cursor) {
        setActivities((prev) => [...prev, ...newActivities]);
      }

      setHasMore(newHasMore);
      setCursor(nextCursor || null);

      if (apiSources) {
        setAvailableSources(apiSources);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetcher.data]);

  // Reset when filters change
  useEffect(() => {
    setActivities([]);
    setCursor(null);
    setHasMore(true);
    setIsInitialLoad(true);
    fetcher.load(buildUrl(null));
  }, [source, buildUrl]); // eslint-disable-line react-hooks/exhaustive-deps

  // Initial load
  useEffect(() => {
    if (isInitialLoad) {
      fetcher.load(buildUrl(null));
    }
  }, [isInitialLoad, buildUrl]); // eslint-disable-line react-hooks/exhaustive-deps

  return {
    activities,
    hasMore,
    loadMore,
    availableSources,
    isLoading: fetcher.state === "loading",
    isInitialLoad,
  };
}
