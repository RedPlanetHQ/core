import React, {
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
} from "react";
import { useChat, type UIMessage } from "@ai-sdk/react";
import {
  DefaultChatTransport,
  lastAssistantMessageIsCompleteWithApprovalResponses,
} from "ai";
import {
  Popover,
  PopoverContent,
  PopoverAnchor,
} from "~/components/ui/popover";
import { ArrowUpRight, Check, Loader2, RotateCcw } from "lucide-react";
import { Button, buttonVariants } from "../ui";
import { cn } from "~/lib/utils";
import {
  ConversationItem,
  ConversationTextarea,
} from "../conversation";
import { hasNeedsApprovalDeep } from "../conversation/conversation-utils";

interface ConversationPart {
  type: string;
  text?: string;
}

interface ConversationHistoryItem {
  id: string;
  role?: "user" | "assistant";
  userType?: string;
  parts?: ConversationPart[];
  createdAt: string;
}

interface ConversationResponse {
  ConversationHistory: ConversationHistoryItem[];
}

interface VisibleMessage {
  id: string;
  role: UIMessage["role"];
  createdAt: string;
}

interface ConversationPopoverProps {
  conversationId: string | null;
  anchorRect: DOMRect | null;
  resolved: boolean;
  butlerName: string;
  onResolvedChange: (conversationId: string, resolved: boolean) => void;
  onClose: () => void;
}

function isTextPart(part: unknown): part is { type: "text"; text: string } {
  if (typeof part !== "object" || part === null) return false;
  if (!("type" in part) || !("text" in part)) return false;

  const candidate = part as { type?: unknown; text?: unknown };
  return candidate.type === "text" && typeof candidate.text === "string";
}

export function ConversationPopover({
  conversationId,
  anchorRect,
  resolved,
  butlerName,
  onResolvedChange,
  onClose,
}: ConversationPopoverProps) {
  const open = !!conversationId && !!anchorRect;
  const [historyMessages, setHistoryMessages] = useState<UIMessage[]>([]);
  const [historyMeta, setHistoryMeta] = useState<Record<string, string>>({});
  const [loadingHistory, setLoadingHistory] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const toolArgOverridesRef = useRef<Record<string, Record<string, unknown>>>(
    {},
  );

  const setToolArgOverride = useCallback(
    (toolCallId: string, args: Record<string, unknown>) => {
      toolArgOverridesRef.current = {
        ...toolArgOverridesRef.current,
        [toolCallId]: {
          ...(toolArgOverridesRef.current[toolCallId] ?? {}),
          ...args,
        },
      };
    },
    [],
  );

  const {
    messages,
    status,
    sendMessage,
    setMessages,
    addToolApprovalResponse,
  } = useChat({
    id: conversationId ?? "conversation-popover",
    messages: historyMessages,
    onFinish: () => {
      toolArgOverridesRef.current = {};
    },
    transport: new DefaultChatTransport({
      api: "/api/v1/conversation",
      prepareSendMessagesRequest({ messages, id }) {
        const toolArgOverrides = toolArgOverridesRef.current;
        const hasApprovals = Object.values(toolArgOverrides).some(
          (e) => "approved" in e,
        );

        if (hasApprovals) {
          return {
            body: { messages, needsApproval: true, id, toolArgOverrides },
          };
        }

        return {
          body: {
            id,
            message: messages[messages.length - 1],
            toolArgOverrides,
          },
        };
      },
    }),
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithApprovalResponses,
  });

  useEffect(() => {
    if (!conversationId) {
      setHistoryMessages([]);
      setHistoryMeta({});
      setMessages([]);
      toolArgOverridesRef.current = {};
      return;
    }

    async function loadConversation() {
      setLoadingHistory(true);
      let data: ConversationResponse;
      try {
        const res = await fetch(`/api/v1/conversation/${conversationId}`);
        if (!res.ok) return;
        data = (await res.json()) as ConversationResponse;
      } catch {
        return;
      } finally {
        setLoadingHistory(false);
      }

      const nextHistory = (data.ConversationHistory ?? []).map((history) => ({
        id: history.id,
        role:
          history.role ?? (history.userType === "Agent" ? "assistant" : "user"),
        parts: history.parts ?? [],
      })) as UIMessage[];

      setHistoryMessages(nextHistory);
      setMessages(nextHistory);
      setHistoryMeta(
        Object.fromEntries(
          (data.ConversationHistory ?? []).map((history) => [
            history.id,
            history.createdAt,
          ]),
        ),
      );
    }

    loadConversation();
  }, [conversationId, setMessages]);

  const sending = status === "submitted" || status === "streaming";

  const visibleMessages = useMemo(() => {
    const normalized = messages
      .map((message) => {
        const hasRenderableParts = (message.parts ?? []).some(
          (part) =>
            isTextPart(part) ||
            (typeof part === "object" &&
              part !== null &&
              "type" in part &&
              typeof (part as { type?: unknown }).type === "string" &&
              (part as { type: string }).type.includes("tool-")),
        );

        if (!hasRenderableParts) return null;

        return {
          id: message.id,
          role: message.role,
          createdAt: historyMeta[message.id] ?? new Date().toISOString(),
        };
      })
      .filter((message): message is VisibleMessage => message !== null);

    const firstAssistantIndex = normalized.findIndex(
      (message) => message.role === "assistant",
    );

    return firstAssistantIndex === -1
      ? []
      : normalized.slice(firstAssistantIndex);
  }, [historyMeta, messages]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [visibleMessages]);

  const lastAssistant = [...messages]
    .reverse()
    .find((message) => message.role === "assistant");

  const needsApproval = lastAssistant?.parts
    ? hasNeedsApprovalDeep(lastAssistant.parts)
    : false;

  const handleToolApprovalResponse = useCallback(
    (params: { id: string; approved: boolean }) => {
      addToolApprovalResponse({ id: params.id, approved: true });
    },
    [addToolApprovalResponse],
  );

  return (
    <Popover
      open={open}
      onOpenChange={(isOpen) => {
        if (!isOpen) onClose();
      }}
    >
      <PopoverAnchor
        style={
          anchorRect
            ? {
                position: "fixed",
                left: anchorRect.left,
                top: anchorRect.bottom,
                width: anchorRect.width,
                height: 0,
                pointerEvents: "none",
              }
            : undefined
        }
      />
      <PopoverContent align="start" sideOffset={8} className="w-80 p-0">
        <div className="flex flex-col">
          <div className="flex items-center justify-between border-b px-3 py-2">
            <span className="text-muted-foreground text-xs font-medium">
              {resolved ? "Resolved" : "Open"}
            </span>
            <div className="flex items-center">
              {conversationId && (
                <a
                  href={`/home/conversation/${conversationId}`}
                  className={cn(buttonVariants({ variant: "ghost" }), "gap-1")}
                >
                  <ArrowUpRight className="h-3.5 w-3.5" />
                  <span>View</span>
                </a>
              )}
              {conversationId && (
                <Button
                  type="button"
                  onClick={() => onResolvedChange(conversationId, !resolved)}
                  variant="ghost"
                  className="gap-1"
                >
                  {resolved ? (
                    <RotateCcw className="h-3.5 w-3.5" />
                  ) : (
                    <Check className="h-3.5 w-3.5" />
                  )}
                  <span>{resolved ? "Reopen" : "Resolve"}</span>
                </Button>
              )}
            </div>
          </div>

          {/* Messages thread */}
          <div className="flex max-h-60 flex-col gap-3 overflow-y-auto p-3">
            {loadingHistory && visibleMessages.length === 0 && (
              <div className="flex items-center gap-2 py-2">
                <Loader2 className="text-muted-foreground h-4 w-4 animate-spin" />
                <span className="text-muted-foreground text-sm">
                  Loading...
                </span>
              </div>
            )}

            {visibleMessages.map((msg) => {
              const message = messages.find((item) => item.id === msg.id);
              if (!message) return null;

              return (
                <ConversationItem
                  key={msg.id}
                  message={message}
                  createdAt={msg.createdAt}
                  addToolApprovalResponse={handleToolApprovalResponse}
                  setToolArgOverride={setToolArgOverride}
                  isChatBusy={sending}
                />
              );
            })}

            {sending && (
              <div className="text-muted-foreground flex items-center gap-1 text-xs">
                <Loader2 className="h-3 w-3 animate-spin" />
                {butlerName} is thinking...
              </div>
            )}

            {!loadingHistory && visibleMessages.length === 0 && !sending && (
              <p className="text-muted-foreground text-sm">No response yet.</p>
            )}

            <div ref={messagesEndRef} />
          </div>

          {/* Reply input */}
          <div className="border-t p-2">
            <ConversationTextarea
              placeholder="Reply..."
              isLoading={sending}
              disabled={needsApproval}
              needsApproval={needsApproval}
              onConversationCreated={(message) => {
                if (!conversationId) return;
                sendMessage({
                  role: "user",
                  parts: [{ type: "text", text: message }],
                });
                onResolvedChange(conversationId, false);
              }}
            />
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
