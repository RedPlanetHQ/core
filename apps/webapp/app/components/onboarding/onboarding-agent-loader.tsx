import { useEffect, useState, useRef } from "react";
import { Loader2 } from "lucide-react";
import { cn } from "~/lib/utils";
import { useChat, type UIMessage } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";

interface OnboardingAgentLoaderProps {
  sessionId: string;
  onComplete: (summary: string) => void;
  className?: string;
}

export function OnboardingAgentLoader({
  sessionId,
  onComplete,
  className,
}: OnboardingAgentLoaderProps) {
  const [updates, setUpdates] = useState<string[]>([]);
  const [summary, setSummary] = useState("");
  const [userHasScrolled, setUserHasScrolled] = useState(false);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const hasStarted = useRef(false);

  const { messages, status, regenerate } = useChat({
    id: sessionId,
    messages: [
      { id: "start", role: "user", parts: [{ text: "start", type: "text" }] },
    ],

    transport: new DefaultChatTransport({
      api: "/api/v1/onboarding/agent",
      prepareSendMessagesRequest({ id, messages }) {
        return { body: {} };
      },
    }),
  });

  // Call regenerate on first component load
  useEffect(() => {
    if (!hasStarted.current) {
      hasStarted.current = true;
      regenerate();
    }
  }, [regenerate]);

  // Extract updates and summary from messages
  useEffect(() => {
    if (messages.length > 0) {
      const lastMessage = messages[messages.length - 1] as UIMessage;

      // Check for tool calls with update_user
      if (lastMessage.role === "assistant") {
        lastMessage.parts?.forEach((part: any) => {
          if (
            part.type.includes("update_user") &&
            part.state === "output-available"
          ) {
            const message = part.input.message;
            if (message && typeof message === "string") {
              setUpdates((prev) => {
                // Avoid duplicates, keep all updates
                if (!prev.includes(message)) {
                  return [...prev, message];
                }
                return prev;
              });
            }
          } else if (
            part.type === "text" &&
            part.text &&
            part.state === "done"
          ) {
            // Accumulate text content as summary
            setSummary((prev) => prev + part.text);
          }
        });
      }
    }
  }, [messages]);

  // When streaming is done, call onComplete with the summary
  useEffect(() => {
    if (status === "ready" && summary) {
      onComplete(summary);
    }
  }, [status, summary, onComplete]);

  // Auto-scroll to bottom when new updates arrive (unless user has scrolled up)
  useEffect(() => {
    if (!userHasScrolled && scrollContainerRef.current) {
      scrollContainerRef.current.scrollTop =
        scrollContainerRef.current.scrollHeight;
    }
  }, [updates, userHasScrolled]);

  // Detect manual scrolling
  const handleScroll = () => {
    if (!scrollContainerRef.current) return;

    const { scrollTop, scrollHeight, clientHeight } =
      scrollContainerRef.current;
    const isAtBottom = Math.abs(scrollHeight - clientHeight - scrollTop) < 10;

    // If user scrolls to bottom, resume auto-scroll
    if (isAtBottom) {
      setUserHasScrolled(false);
    } else {
      // If not at bottom, user has manually scrolled
      setUserHasScrolled(true);
    }
  };

  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center space-y-6",
        className,
      )}
    >
      <div className="flex items-center space-x-2">
        <Loader2 className="size-5 animate-spin" />
        <h2 className="text-lg">
          {status === "ready" && summary
            ? "learned some things about you"
            : "learning about you..."}
        </h2>
      </div>

      <div
        ref={scrollContainerRef}
        onScroll={handleScroll}
        className="h-[400px] w-full max-w-2xl space-y-2 overflow-y-auto"
      >
        {updates.map((update, index) => (
          <div
            key={index}
            className="animate-in fade-in slide-in-from-bottom-2 bg-background-3 rounded-lg border border-gray-200 p-3 text-sm duration-1000"
          >
            {update}
          </div>
        ))}
      </div>
    </div>
  );
}
