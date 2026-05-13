import { createContext, useContext, type ReactNode } from "react";

/**
 * Lets deeply-nested tool renderers (e.g. suggest_integrations cards)
 * inject a user message into the surrounding chat without prop drilling
 * through ConversationItem → Tool → SuggestIntegrationsCards.
 *
 * The provider lives on ConversationView and wraps `useChat`'s
 * sendMessage so consumers can fire a turn programmatically.
 */
interface ChatContextValue {
  sendMessage: (text: string) => void;
}

const ChatContext = createContext<ChatContextValue | null>(null);

export function ChatContextProvider({
  sendMessage,
  children,
}: {
  sendMessage: (text: string) => void;
  children: ReactNode;
}) {
  return (
    <ChatContext.Provider value={{ sendMessage }}>
      {children}
    </ChatContext.Provider>
  );
}

/**
 * Returns the chat context if available. Components that work both
 * inside and outside a chat thread should null-check before calling
 * sendMessage.
 */
export function useChatContext(): ChatContextValue | null {
  return useContext(ChatContext);
}
