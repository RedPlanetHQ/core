/**
 * Popover that shows a conversation thread when clicking a paragraph
 * with an attached conversationId (from scratchpad detection).
 *
 * Shows text messages from both user and assistant (no tool calls).
 * Supports replies and polls for in-progress conversations.
 */

import React, { useState, useEffect, useRef, useCallback } from "react";
import { Popover, PopoverContent, PopoverAnchor } from "~/components/ui/popover";
import { Loader2, Send } from "lucide-react";

interface ConversationMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  createdAt: string;
}

interface ConversationPopoverProps {
  conversationId: string | null;
  anchorRect: DOMRect | null;
  butlerName: string;
  pageId: string;
  onClose: () => void;
}

export function ConversationPopover({
  conversationId,
  anchorRect,
  butlerName,
  pageId,
  onClose,
}: ConversationPopoverProps) {
  const open = !!conversationId && !!anchorRect;
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [replyText, setReplyText] = useState("");
  const [sending, setSending] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Fetch conversation when opened
  useEffect(() => {
    if (!conversationId) {
      setMessages([]);
      setStatus(null);
      setReplyText("");
      return;
    }

    let cancelled = false;
    let pollTimer: ReturnType<typeof setInterval> | null = null;

    async function fetchConversation() {
      setLoading(true);
      try {
        const res = await fetch(`/api/v1/conversation/${conversationId}`);
        if (!res.ok) return;
        const data = await res.json();

        if (cancelled) return;

        const convStatus = data.status ?? "completed";
        setStatus(convStatus);

        // Extract text messages from both user and assistant
        const msgs: ConversationMessage[] = [];
        for (const history of data.ConversationHistory ?? []) {
          const role = history.role ?? (history.userType === "Agent" ? "assistant" : "user");

          const textParts = (history.parts ?? [])
            .filter((p: any) => p.type === "text" && p.text)
            .map((p: any) => p.text)
            .join("\n");

          if (textParts.trim()) {
            msgs.push({
              id: history.id,
              role: role as "user" | "assistant",
              text: textParts.trim(),
              createdAt: history.createdAt,
            });
          }
        }

        setMessages(msgs);
        setLoading(false);

        // If still running, poll every 3s
        if (convStatus === "running" && !pollTimer) {
          pollTimer = setInterval(fetchConversation, 3000);
        }

        // Stop polling once done
        if (convStatus !== "running" && pollTimer) {
          clearInterval(pollTimer);
          pollTimer = null;
        }
      } catch {
        setLoading(false);
      }
    }

    fetchConversation();

    return () => {
      cancelled = true;
      if (pollTimer) clearInterval(pollTimer);
    };
  }, [conversationId]);

  // Scroll to bottom when messages update
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleReply = useCallback(async () => {
    if (!replyText.trim() || !conversationId || sending) return;

    const message = replyText.trim();
    setReplyText("");
    setSending(true);

    // Optimistically add user message
    setMessages((prev) => [
      ...prev,
      {
        id: `temp-${Date.now()}`,
        role: "user",
        text: message,
        createdAt: new Date().toISOString(),
      },
    ]);

    try {
      await fetch(`/api/v1/page/${pageId}/reply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId, message }),
      });
      // Status will switch to "running" on next poll
      setStatus("running");
    } catch {
      // ignore
    } finally {
      setSending(false);
    }
  }, [conversationId, pageId, replyText, sending]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleReply();
      }
    },
    [handleReply],
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
          {/* Messages thread */}
          <div className="max-h-60 overflow-y-auto p-3 flex flex-col gap-3">
            {loading && messages.length === 0 && (
              <div className="flex items-center gap-2 py-2">
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                <span className="text-sm text-muted-foreground">Loading...</span>
              </div>
            )}

            {messages.map((msg) => (
              <div key={msg.id} className="flex flex-col gap-0.5">
                <div className="flex items-center gap-1.5">
                  <span className="text-xs font-medium text-muted-foreground">
                    {msg.role === "assistant" ? butlerName : "You"}
                  </span>
                  <span className="text-[10px] text-muted-foreground/60">
                    {new Date(msg.createdAt).toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                </div>
                <p className="text-sm leading-relaxed whitespace-pre-wrap">
                  {msg.text}
                </p>
              </div>
            ))}

            {status === "running" && (
              <div className="flex items-center gap-1 text-xs text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" />
                {butlerName} is thinking...
              </div>
            )}

            {!loading && messages.length === 0 && status !== "running" && (
              <p className="text-sm text-muted-foreground">No response yet.</p>
            )}

            <div ref={messagesEndRef} />
          </div>

          {/* Reply input */}
          <div className="border-t px-3 py-2 flex items-center gap-2">
            <input
              ref={inputRef}
              type="text"
              placeholder="Reply..."
              value={replyText}
              onChange={(e) => setReplyText(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={sending}
              className="flex-1 text-sm bg-transparent outline-none placeholder:text-muted-foreground/50"
            />
            <button
              onClick={handleReply}
              disabled={!replyText.trim() || sending}
              className="text-muted-foreground hover:text-foreground disabled:opacity-30 transition-colors"
            >
              {sending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Send className="h-3.5 w-3.5" />
              )}
            </button>
          </div>

          {/* View full conversation link */}
          {conversationId && (
            <div className="border-t px-3 py-1.5 text-center">
              <a
                href={`/home/conversations/${conversationId}`}
                className="text-xs text-muted-foreground underline hover:text-foreground"
              >
                View full conversation
              </a>
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
