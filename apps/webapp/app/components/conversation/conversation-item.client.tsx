import { EditorContent, useEditor } from "@tiptap/react";

import { useEffect, memo } from "react";
import { UserTypeEnum } from "@core/types";
import { type ConversationHistory } from "@core/database";
import { cn } from "~/lib/utils";
import { extensionsForConversation } from "./editor-extensions";
import { skillExtension } from "../editor/skill-extension";

interface AIConversationItemProps {
  conversationHistory: ConversationHistory;
}

const ConversationItemComponent = ({
  conversationHistory,
}: AIConversationItemProps) => {
  const isUser =
    conversationHistory.userType === UserTypeEnum.User ||
    conversationHistory.userType === UserTypeEnum.System;

  const id = `a${conversationHistory.id.replace(/-/g, "")}`;

  const editor = useEditor({
    extensions: [...extensionsForConversation, skillExtension],
    editable: false,
    content: conversationHistory.message,
  });

  useEffect(() => {
    editor?.commands.setContent(conversationHistory.message);

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, conversationHistory.message]);

  if (!conversationHistory.message) {
    return null;
  }

  return (
    <div className={cn("flex gap-2 px-4 pb-2", isUser && "my-4 justify-end")}>
      <div
        className={cn(
          "flex flex-col",
          isUser && "bg-primary/20 max-w-[500px] rounded-md p-3",
        )}
      >
        <EditorContent editor={editor} className="editor-container" />
      </div>
    </div>
  );
};

// Memoize to prevent unnecessary re-renders
export const ConversationItem = memo(ConversationItemComponent, (prevProps, nextProps) => {
  // Only re-render if the conversation history ID or message changed
  return (
    prevProps.conversationHistory.id === nextProps.conversationHistory.id &&
    prevProps.conversationHistory.message === nextProps.conversationHistory.message
  );
});
