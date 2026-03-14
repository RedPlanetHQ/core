import { Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

const PHRASES = [
  "Thinking",
  "Analyzing",
  "Processing",
  "Searching",
  "Reasoning",
  "Planning",
  "Reading",
  "Scanning",
  "Drafting",
  "Exploring",
  "Evaluating",
  "Synthesizing",
  "Reviewing",
  "Connecting",
  "Mapping",
  "Gathering",
  "Calibrating",
  "Verifying",
  "Interpreting",
  "Coordinating",
  "Considering",
  "Tracing",
  "Computing",
  "Assembling",
  "Refining",
  "Calculating",
  "Querying",
  "Inspecting",
  "Parsing",
  "Orchestrating",
  "Contextualizing",
  "Distilling",
  "Classifying",
  "Inferring",
  "Prioritizing",
  "Summarizing",
  "Cross-referencing",
  "Navigating",
  "Fetching",
  "Deciding",
  "Constructing",
  "Weighing",
  "Filtering",
  "Resolving",
  "Diagnosing",
  "Matching",
  "Extracting",
  "Routing",
  "Delegating",
  "Almost there",
];

export function ThinkingIndicator({ isLoading }: { isLoading: boolean }) {
  const [index, setIndex] = useState(() =>
    Math.floor(Math.random() * PHRASES.length),
  );
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (isLoading) {
      intervalRef.current = setInterval(() => {
        setIndex((i) => (i + 1) % PHRASES.length);
      }, 10000);
    } else {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [isLoading]);

  if (!isLoading) return null;

  return (
    <div className="flex items-center gap-2 pb-2 pl-1">
      <Loader2 className="text-muted-foreground h-4 w-4 animate-spin" />
      <span className="text-muted-foreground text-sm">{PHRASES[index]}</span>
    </div>
  );
}
