import { Outlet } from "@remix-run/react";
import { ChatAgentHeader } from "~/components/conversation/chat-agent-header";

export default function ConversationLayout() {
  return (
    <div className="h-page-xs flex flex-col">
      <ChatAgentHeader />

      <div className="flex-1 overflow-hidden">
        <Outlet />
      </div>
    </div>
  );
}
