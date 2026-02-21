import { useEffect, useState, useCallback } from "react";
import { useFetcher } from "@remix-run/react";

export interface SkillItem {
  id: string;
  title: string;
  content: string;
  source: string;
  type: string;
  labelIds: string[];
  metadata?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface SkillsResponse {
  skills: SkillItem[];
  hasMore: boolean;
  nextCursor?: string | null;
  totalCount: number;
}

export function useSkills() {
  const fetcher = useFetcher<SkillsResponse>();
  const [skills, setSkills] = useState<SkillItem[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [isInitialLoad, setIsInitialLoad] = useState(true);

  const buildUrl = useCallback((cursorValue: string | null) => {
    const params = new URLSearchParams();
    params.set("limit", "50");
    if (cursorValue) params.set("cursor", cursorValue);
    return `/api/v1/skills?${params.toString()}`;
  }, []);

  const loadMore = useCallback(() => {
    if (fetcher.state === "idle" && hasMore && cursor) {
      fetcher.load(buildUrl(cursor));
    }
  }, [hasMore, cursor, buildUrl, fetcher]);

  const reset = useCallback(() => {
    setSkills([]);
    setCursor(null);
    setHasMore(true);
    setIsInitialLoad(true);
    fetcher.load(buildUrl(null));
  }, [buildUrl, fetcher]);

  // Handle fetcher data updates
  useEffect(() => {
    if (fetcher.data) {
      const {
        skills: newSkills,
        hasMore: newHasMore,
        nextCursor,
      } = fetcher.data;

      const isReset = cursor === null && skills.length === 0;

      if (isReset) {
        setSkills(newSkills);
        setIsInitialLoad(false);
      } else if (nextCursor !== cursor) {
        setSkills((prev) => [...prev, ...newSkills]);
      }

      setHasMore(newHasMore);
      setCursor(nextCursor || null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetcher.data]);

  // Initial load
  useEffect(() => {
    if (isInitialLoad) {
      fetcher.load(buildUrl(null));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isInitialLoad, buildUrl]);

  return {
    skills,
    hasMore,
    loadMore,
    reset,
    isLoading: fetcher.state === "loading",
    isInitialLoad,
  };
}
