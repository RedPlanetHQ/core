import React, { useState, useRef, useCallback } from "react";
import { Popover, PopoverContent, PopoverAnchor } from "~/components/ui/popover";

interface CommentData {
  id: string;
  content: string;
  selectedText: string;
  createdAt: string;
  conversationId?: string;
}

interface ButlerCommentPopoverProps {
  comment: CommentData | null;
  anchorRect: DOMRect | null;
  butlerName: string;
  pageId: string;
  onResolve: (commentId: string) => void;
  onReply: (conversationId: string, message: string) => void;
  onClose: () => void;
}

export function ButlerCommentPopover({
  comment,
  anchorRect,
  butlerName,
  pageId,
  onResolve,
  onReply,
  onClose,
}: ButlerCommentPopoverProps) {
  const open = !!comment && !!anchorRect;
  const [replyText, setReplyText] = useState("");
  const [sending, setSending] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleReply = useCallback(async () => {
    if (!replyText.trim() || !comment?.conversationId || sending) return;
    setSending(true);
    onReply(comment.conversationId, replyText.trim());
    setReplyText("");
    setSending(false);
  }, [replyText, comment, sending, onReply]);

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
        if (!isOpen) {
          setReplyText("");
          onClose();
        }
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
      <PopoverContent align="start" sideOffset={8} className="w-80 p-3">
        {comment && (
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground">{butlerName}</span>
              <span className="text-xs text-muted-foreground">
                {new Date(comment.createdAt).toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </span>
            </div>
            <p className="text-sm leading-relaxed">{comment.content}</p>
            {comment.conversationId && (
              <div className="flex gap-1.5 mt-1">
                <input
                  ref={inputRef}
                  type="text"
                  value={replyText}
                  onChange={(e) => setReplyText(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Reply..."
                  disabled={sending}
                  className="flex-1 rounded border border-border bg-background px-2 py-1 text-sm outline-none focus:border-primary"
                />
                <button
                  onClick={handleReply}
                  disabled={!replyText.trim() || sending}
                  className="rounded bg-primary px-2 py-1 text-xs text-primary-foreground disabled:opacity-50"
                >
                  Send
                </button>
              </div>
            )}
            <button
              className="self-end text-xs text-muted-foreground underline hover:text-foreground"
              onClick={() => onResolve(comment.id)}
            >
              Resolve
            </button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
