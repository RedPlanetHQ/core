import { useState, useRef, useCallback, useEffect } from "react";
import { useFetcher, useNavigate } from "@remix-run/react";
import { useEditor, EditorContent } from "@tiptap/react";
import { Document } from "@tiptap/extension-document";
import { Paragraph } from "@tiptap/extension-paragraph";
import { Text } from "@tiptap/extension-text";
import HardBreak from "@tiptap/extension-hard-break";
import { History } from "@tiptap/extension-history";
import Placeholder from "@tiptap/extension-placeholder";
import { ArrowUp, X, MessageSquare, Plus, Maximize2 } from "lucide-react";
import { Button } from "~/components/ui/button";
import {
  ConversationView,
  type LLMModel,
  SUGGESTED,
} from "~/components/conversation";
import { UserTypeEnum } from "@core/types";
import { cn } from "~/lib/utils";

import { useChatPanel } from "~/components/chat-panel/chat-panel-context";
import { ConversationHistoryPopover } from "~/components/conversation/conversation-history-popover";

interface GlobalChatPanelProps {
  agentName: string;
  onClose: () => void;
  models: LLMModel[];
  integrationAccountMap: Record<string, string>;
  enableBurstSafeReplyRecovery?: boolean;
}

// Minimal chat input — creates a conversation and hands off to ConversationView
function ChatInput({
  agentName,
  onCreated,
}: {
  agentName: string;
  onCreated: (convId: string, historyId: string, message: string) => void;
}) {
  const fetcher = useFetcher<{
    conversationId: string;
    conversation: { conversationHistoryId?: string };
  }>();
  const [content, setContent] = useState("");
  const contentRef = useRef("");
  const doSubmitRef = useRef<(msg: string) => void>(() => {});
  const submittedMessageRef = useRef("");

  const doSubmit = useCallback(
    (messageContent: string) => {
      submittedMessageRef.current = messageContent;
      fetcher.submit(
        {
          message: messageContent,
          title: messageContent,
          incognito: "false",
          modelId: "",
          panelMode: "true",
        },
        { action: "/home/conversation", method: "post" },
      );
      setContent("");
    },
    [fetcher],
  );

  useEffect(() => {
    doSubmitRef.current = doSubmit;
  }, [doSubmit]);

  // When conversation is created, hand off to parent
  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.conversationId) {
      onCreated(
        fetcher.data.conversationId,
        fetcher.data.conversation?.conversationHistoryId ?? "",
        submittedMessageRef.current,
      );
    }
  }, [fetcher.state, fetcher.data]);

  const editor = useEditor({
    extensions: [
      Placeholder.configure({
        placeholder: () => `Ask ${agentName}...`,
        includeChildren: true,
      }),
      Document,
      Paragraph,
      Text,
      HardBreak.configure({ keepMarks: true }),
      History,
    ],
    immediatelyRender: false,
    editorProps: {
      attributes: {
        class: `prose prose-sm dark:prose-invert focus:outline-none max-w-full`,
      },
      handleKeyDown: (_view, event) => {
        if (event.key === "Enter" && !event.shiftKey) {
          event.preventDefault();
          if (contentRef.current.trim()) {
            doSubmitRef.current(contentRef.current);
          }
          return true;
        }
        return false;
      },
    },
    onUpdate({ editor: e }) {
      const html = e.getHTML();
      setContent(html);
      contentRef.current = html;
    },
  });

  const handleSelectPrompt = useCallback(
    (prompt: string) => {
      const htmlContent = `<p>${prompt}</p>`;
      editor?.commands.setContent(htmlContent);
      setContent(htmlContent);
    },
    [editor],
  );

  const isLoading = fetcher.state !== "idle";

  return (
    <div className="flex flex-1 flex-col">
      <div className="flex flex-1 flex-col items-center justify-center gap-3">
        <h1 className="text-3xl font-medium tracking-tight">
          What can I help with?
        </h1>
      </div>

      {/* Input */}
      <div className="flex w-full flex-col items-center px-4 pb-4">
        <div className="w-full max-w-[720px]">
          <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {SUGGESTED.map((item, i) => {
              const Icon = item.icon;
              return (
                <button
                  key={i}
                  type="button"
                  onClick={() => handleSelectPrompt(item.prompt)}
                  className={cn(
                    "hover:bg-background/80 bg-background/50 flex flex-col gap-2 rounded-xl border border-gray-300 p-2 text-left transition-colors",
                  )}
                >
                  <Icon className="h-5 w-5 shrink-0" />
                  <p className="text-muted-foreground line-clamp-2 text-sm">
                    {item.prompt}
                  </p>
                </button>
              );
            })}
          </div>

          <div className="bg-background-3 rounded-xl">
            <EditorContent
              editor={editor}
              className="max-h-[160px] min-h-[44px] overflow-auto px-3 pt-3 text-sm"
            />
            <div className="flex items-center justify-end px-2 pb-2 pt-1">
              <Button
                type="button"
                variant="secondary"
                className="gap-1 rounded"
                onClick={() => {
                  if (content.trim()) doSubmit(content);
                }}
                disabled={!content.trim() || isLoading}
              >
                <ArrowUp size={14} />
                {isLoading ? "Loading..." : "Chat"}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function GlobalChatPanel({
  agentName,
  onClose,
  models,
  integrationAccountMap,
  enableBurstSafeReplyRecovery = false,
}: GlobalChatPanelProps) {
  const { pinnedConversationId } = useChatPanel()!;
  const navigate = useNavigate();

  const [activeConversation, setActiveConversation] = useState<{
    conversationId: string;
    status?: string;
    history: Array<{
      id: string;
      userType: string;
      message: string;
      parts: any[];
    }>;
  } | null>(null);

  const historyFetcher = useFetcher<{
    conversation: {
      id: string;
      status: string;
      ConversationHistory: Array<{
        id: string;
        userType: string;
        message: string;
        parts: any[];
      }>;
    };
  }>();

  const pendingHistoryId = useRef<string | null>(null);

  // Load a pinned conversation when set via context
  useEffect(() => {
    if (pinnedConversationId) {
      pendingHistoryId.current = pinnedConversationId;
      historyFetcher.load(`/home/conversation/${pinnedConversationId}`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pinnedConversationId]);

  const handleConversationCreated = (
    conversationId: string,
    historyId: string,
    message: string,
  ) => {
    setActiveConversation({
      conversationId,
      status: "pending",
      history: [
        {
          id: historyId,
          userType: UserTypeEnum.User,
          message,
          parts: [{ text: message, type: "text" }],
        },
      ],
    });
  };

  const handleSelectHistory = (conversationId: string) => {
    pendingHistoryId.current = conversationId;
    historyFetcher.load(`/home/conversation/${conversationId}`);
  };

  useEffect(() => {
    if (
      historyFetcher.state === "idle" &&
      historyFetcher.data?.conversation &&
      pendingHistoryId.current
    ) {
      const conv = historyFetcher.data.conversation;
      setActiveConversation({
        conversationId: pendingHistoryId.current,
        status: conv.status,
        history: conv.ConversationHistory ?? [],
      });
      pendingHistoryId.current = null;
    }
  }, [historyFetcher.state, historyFetcher.data]);

  const handleNewChat = () => {
    setActiveConversation(null);
  };

  return (
    <div className="border-l-0.5 border-border flex h-full flex-col">
      {/* Header */}
      <div className="flex h-[40px] items-center justify-between border-b px-3 py-2">
        <div className="flex items-center gap-2">
          <ConversationHistoryPopover
            onSelect={handleSelectHistory}
            currentConversationId={activeConversation?.conversationId}
          />
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            className="rounded"
            title="Open full view"
            onClick={() =>
              navigate(
                activeConversation
                  ? `/home/conversation/${activeConversation.conversationId}`
                  : "/home/conversation",
              )
            }
          >
            <Maximize2 size={14} />
          </Button>
          {activeConversation && (
            <Button
              variant="ghost"
              className="rounded"
              onClick={handleNewChat}
              title="New chat"
            >
              <Plus size={14} />
            </Button>
          )}
          <Button variant="ghost" className="rounded" onClick={onClose}>
            <X size={14} />
          </Button>
        </div>
      </div>

      {/* Content */}
      {activeConversation ? (
        <div className="flex h-[100vh] flex-col overflow-hidden border-b md:h-[calc(100vh_-_56px)]">
          <ConversationView
            conversationId={activeConversation.conversationId}
            history={activeConversation.history}
            autoRegenerate
            enableBurstSafeFirstReplyRecovery={enableBurstSafeReplyRecovery}
            integrationAccountMap={integrationAccountMap}
            conversationStatus={activeConversation.status}
            models={models}
          />
        </div>
      ) : (
        <ChatInput
          agentName={agentName}
          onCreated={handleConversationCreated}
        />
      )}
    </div>
  );
}
