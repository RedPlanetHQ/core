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
    if (messages.length === 0) return;
    const lastMessage = messages[messages.length - 1] as UIMessage;
    if (lastMessage.role !== "assistant") return;

    lastMessage.parts?.forEach((part: any) => {
      // Tool part: type is "tool-invocation" (AI SDK) or "tool-progress_update" (Mastra)
      const isProgressUpdate =
        part.toolName === "progress_update" ||
        part.type === "tool-progress_update";

      if (isProgressUpdate) {
        const msg = part.args?.message ?? part.input?.message;
        if (msg && typeof msg === "string") {
          setLatestUpdate(msg);
        }
      }

      // Text part: no state field needed — just check type and text presence
      if (part.type === "text" && part.text) {
        setSummary(part.text);
      }
    });
  }, [messages]);

  // When streaming is done, call onComplete with the summary
  useEffect(() => {
    if (status === "ready" && summary) {
      setTimeout(() => {
        onComplete(summary);
      }, 2000);
    }
  }, [status, summary, onComplete]);

  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center space-y-6",
        className,
      )}
    >
      <div className="flex flex-col items-center gap-2">
        <h2 className="max-w-[300px] text-xl">One moment. A good butler does his homework.</h2>
        <Loader2 className="mb-10 size-5 animate-spin" />
        <h2 className="text-muted-foreground max-w-[300px] text-lg">
          {status === "ready" && summary
            ? "I think we shall get along rather well."
            : latestUpdate || "Acquainting myself with your world..."}
        </h2>
      </div>
    </div>
  );
}
