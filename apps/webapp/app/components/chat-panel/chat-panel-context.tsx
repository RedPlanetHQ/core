import {
  createContext,
  useContext,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { PanelImperativeHandle } from "react-resizable-panels";

interface ChatPanelContextValue {
  chatOpen: boolean;
  openChat: () => void;
  closeChat: () => void;
  toggleChat: () => void;
  /** Open the panel and show a specific conversation */
  openChatWithConversation: (conversationId: string) => void;
  /** The conversation ID pinned to the panel (if any) */
  pinnedConversationId: string | null;
  /** Task ID for the currently viewed task — filters history to that task's runs */
  currentTaskId: string | null;
  setCurrentTaskId: (taskId: string | null) => void;
  /** Call from ResizablePanel's onCollapse — updates state without re-triggering panel */
  onPanelCollapse: () => void;
  panelRef: React.RefObject<PanelImperativeHandle | null>;
}

const ChatPanelContext = createContext<ChatPanelContextValue | null>(null);

export function ChatPanelProvider({ children }: { children: ReactNode }) {
  const [chatOpen, setChatOpen] = useState(false);
  const [pinnedConversationId, setPinnedConversationId] = useState<string | null>(null);
  const [currentTaskId, setCurrentTaskId] = useState<string | null>(null);
  const panelRef = useRef<PanelImperativeHandle>(null);

  const openChat = () => {
    panelRef.current?.resize(30);
    setChatOpen(true);
  };

  const closeChat = () => {
    panelRef.current?.collapse();
    setChatOpen(false);
    setPinnedConversationId(null);
  };

  const toggleChat = () => {
    if (chatOpen) closeChat();
    else openChat();
  };

  const openChatWithConversation = (conversationId: string) => {
    setPinnedConversationId(conversationId);
    panelRef.current?.resize(30);
    setChatOpen(true);
  };

  // Only updates state — used by the panel's onCollapse callback to stay in sync
  // when the user drags the handle shut
  const onPanelCollapse = () => {
    setChatOpen(false);
    setPinnedConversationId(null);
  };

  return (
    <ChatPanelContext.Provider
      value={{
        chatOpen,
        openChat,
        closeChat,
        toggleChat,
        openChatWithConversation,
        pinnedConversationId,
        currentTaskId,
        setCurrentTaskId,
        onPanelCollapse,
        panelRef,
      }}
    >
      {children}
    </ChatPanelContext.Provider>
  );
}

export function useChatPanel() {
  return useContext(ChatPanelContext);
}
