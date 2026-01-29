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
  const [latestUpdate, setLatestUpdate] = useState<string>("");
  const [summary, setSummary] = useState("");
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


  // Extract latest update and summary from messages
  useEffect(() => {
    if (messages.length > 0) {
      const lastMessage = messages[messages.length - 1] as UIMessage;

      // Check for tool calls with progress_update
      if (lastMessage.role === "assistant") {
        lastMessage.parts?.forEach((part: any) => {
          if (
            part.type.includes("progress_update") &&
            part.state === "output-available"
          ) {
            const message = part.input.message;
            if (message && typeof message === "string") {
              // Replace with latest update
              setLatestUpdate(message);
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
      setTimeout(() => {
        onComplete(summary);
      }, 2000)
    }
  }, [status, summary, onComplete]);

  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center space-y-6",
        className,
      )}
    >
      <div className="flex items-center gap-2 flex-col">
        <Loader2 className="size-5 animate-spin" />
        <h2 className="text-lg max-w-[300px]">
          {status === "ready" && summary
            ? "learned some things about you"
            : latestUpdate || "learning about you..."}
        </h2>
      </div>
    </div>
  );
}
