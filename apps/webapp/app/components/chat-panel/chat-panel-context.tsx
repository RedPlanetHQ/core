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
  /** Call from ResizablePanel's onCollapse — updates state without re-triggering panel */
  onPanelCollapse: () => void;
  panelRef: React.RefObject<PanelImperativeHandle | null>;
}

const ChatPanelContext = createContext<ChatPanelContextValue | null>(null);

export function ChatPanelProvider({ children }: { children: ReactNode }) {
  const [chatOpen, setChatOpen] = useState(false);
  const panelRef = useRef<PanelImperativeHandle>(null);

  const openChat = () => {
    panelRef.current?.resize(30);
    setChatOpen(true);
  };

  const closeChat = () => {
    panelRef.current?.collapse();
    setChatOpen(false);
  };

  const toggleChat = () => {
    if (chatOpen) closeChat();
    else openChat();
  };

  // Only updates state — used by the panel's onCollapse callback to stay in sync
  // when the user drags the handle shut
  const onPanelCollapse = () => setChatOpen(false);

  return (
    <ChatPanelContext.Provider
      value={{
        chatOpen,
        openChat,
        closeChat,
        toggleChat,
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
