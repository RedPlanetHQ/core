import { EditorContent, useEditor } from "@tiptap/react";

import { useEffect, memo } from "react";
import { cn } from "~/lib/utils";
import { extensionsForConversation } from "./editor-extensions";
import { skillExtension } from "../editor/skill-extension";
import { type UIMessage } from "ai";

interface AIConversationItemProps {
  message: UIMessage;
}

const ConversationItemComponent = ({ message }: AIConversationItemProps) => {
  const isUser = message.role === "user" || false;
  const textPart = message.parts.find((part) => part.type === "text");

  const editor = useEditor({
    extensions: [...extensionsForConversation, skillExtension],
    editable: false,
    content: textPart ? textPart.text : "",
  });

  useEffect(() => {
    if (textPart) {
      editor?.commands.setContent(textPart.text);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [message]);

  if (!message) {
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
export const ConversationItem = memo(
  ConversationItemComponent,
  (prevProps, nextProps) => {
    // Only re-render if the conversation history ID or message changed
    return prevProps.message === nextProps.message;
  },
);
