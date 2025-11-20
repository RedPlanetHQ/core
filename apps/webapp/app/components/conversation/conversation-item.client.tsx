import { EditorContent, useEditor } from "@tiptap/react";

import { useEffect, memo, useState } from "react";
import { cn } from "~/lib/utils";
import { extensionsForConversation } from "./editor-extensions";
import { skillExtension } from "../editor/skill-extension";
import { type ToolUIPart, type UIMessage } from "ai";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "../ui/collapsible";
import StaticLogo from "../logo/logo";
import { titleCase } from "~/utils";
import { Button } from "../ui";
import { ChevronsUpDown } from "lucide-react";

interface AIConversationItemProps {
  message: UIMessage;
}

function getMessage(message: string) {
  let finalMessage = message.replace("<final_response>", "");
  finalMessage = finalMessage.replace("</final_response>", "");
  finalMessage = finalMessage.replace("<question_response>", "");
  finalMessage = finalMessage.replace("</question_response>", "");

  return finalMessage;
}

const Tool = ({ part }: { part: ToolUIPart<any> }) => {
  const [isOpen, setIsOpen] = useState(false);
  const textPart = part.output?.content ? part.output?.content[0]?.text : "";

  return (
    <Collapsible
      open={isOpen}
      onOpenChange={setIsOpen}
      className="bg-grayAlpha-100 my-1 rounded px-2"
    >
      <CollapsibleTrigger asChild>
        <Button
          variant="link"
          full
          size="xl"
          className="flex justify-between px-2 py-2"
        >
          <div className="flex items-center gap-2">
            <StaticLogo size={18} className="rounded-sm" />
            {titleCase(part.type.replace("tool-", "").replace(/_/g, " "))}
          </div>

          <ChevronsUpDown size={16} />
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="flex flex-col gap-2">
          <div className="bg-grayAlpha-100 rounded p-2">
            <p className="text-muted-foreground text-sm"> Request </p>
            <p className="mt-2 font-mono text-[#BF4594]">
              {JSON.stringify(part.input, null, 2)}
            </p>
          </div>
          <div className="bg-grayAlpha-100 mb-2 rounded p-2">
            <p className="text-muted-foreground text-sm"> Response </p>
            <p className="mt-2 font-mono text-[#BF4594]">{textPart}</p>
          </div>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
};

const ConversationItemComponent = ({ message }: AIConversationItemProps) => {
  const isUser = message.role === "user" || false;
  const textPart = message.parts.find((part) => part.type === "text");

  const editor = useEditor({
    extensions: [...extensionsForConversation, skillExtension],
    editable: false,
    content: textPart ? getMessage(textPart.text) : "",
  });

  useEffect(() => {
    if (textPart) {
      editor?.commands.setContent(getMessage(textPart.text));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [message]);

  if (!message) {
    return null;
  }

  const getComponent = (part: any) => {
    if (part.type.includes("tool-")) {
      return <Tool part={part as any} />;
    }

    if (part.type.includes("text")) {
      return <EditorContent editor={editor} className="editor-container" />;
    }

    return null;
  };

  return (
    <div className={cn("flex gap-2 px-4 pb-2", isUser && "my-4 justify-end")}>
      <div
        className={cn(
          "flex flex-col",
          isUser && "bg-primary/20 max-w-[500px] rounded-md p-3",
        )}
      >
        {message.parts.map((part, index) => (
          <div key={index}>{getComponent(part)}</div>
        ))}
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
