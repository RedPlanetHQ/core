import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { cn } from "~/lib/utils";
import { useChat, type UIMessage } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { Button } from "../ui";

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

  console.log(messages);

  // Extract updates and summary from messages
  useEffect(() => {
    if (messages.length > 0) {
      const lastMessage = messages[messages.length - 1] as UIMessage;

      console.log(lastMessage);
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
                // Avoid duplicates
                if (!prev.includes(message)) {
                  return [...prev, message];
                }
                return prev;
              });
            }
          } else if (part.type === "text" && part.text) {
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

  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center space-y-6",
        className,
      )}
    >
      <div className="flex items-center space-x-3">
        <Loader2 className="size-6 animate-spin" />
        <h2 className="text-lg font-medium">
          {status === "ready"
            ? "Analysis Complete!"
            : "Analyzing your emails..."}
        </h2>
        <Button onClick={() => regenerate()}>staret</Button>
      </div>

      <div className="w-full max-w-2xl space-y-2">
        {updates.map((update, index) => (
          <div
            key={index}
            className="animate-in fade-in slide-in-from-bottom-2 bg-background-3 rounded-lg border border-gray-200 p-3 text-sm"
          >
            {update}
          </div>
        ))}
      </div>
    </div>
  );
}
