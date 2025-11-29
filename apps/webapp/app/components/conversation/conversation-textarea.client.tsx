import { Document } from "@tiptap/extension-document";
import HardBreak from "@tiptap/extension-hard-break";
import { History } from "@tiptap/extension-history";
import { Paragraph } from "@tiptap/extension-paragraph";
import { Text } from "@tiptap/extension-text";
import { type Editor } from "@tiptap/react";
import { EditorContent, Placeholder, EditorRoot } from "novel";
import { useCallback, useState } from "react";
import { cn } from "~/lib/utils";
import { Button } from "../ui";
import { LoaderCircle } from "lucide-react";
import { useSubmit } from "@remix-run/react";

interface ConversationTextareaProps {
  defaultValue?: string;
  placeholder?: string;
  isLoading?: boolean;
  className?: string;
  onChange?: (text: string) => void;
  disabled?: boolean;
  onConversationCreated?: (message: string) => void;
  stop?: () => void;
}

export function ConversationTextarea({
  defaultValue,
  isLoading = false,
  placeholder,
  onChange,
  onConversationCreated,
  stop,
}: ConversationTextareaProps) {
  const [text, setText] = useState(defaultValue ?? "");
  const [editor, setEditor] = useState<Editor>();
  const submit = useSubmit();

  const onUpdate = (editor: Editor) => {
    setText(editor.getHTML());
    onChange && onChange(editor.getText());
  };

  const handleSend = useCallback(() => {
    if (!editor || !text) {
      return;
    }

    onConversationCreated && onConversationCreated(text);

    editor?.commands.clearContent(true);
    setText("");
  }, [editor, text]);

  return (
    <div className="bg-background-3 rounded-lg border-1 border-gray-300 py-2">
      <EditorRoot>
        <EditorContent
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          initialContent={defaultValue as any}
          extensions={[
            Document,
            Paragraph,
            Text,
            HardBreak.configure({
              keepMarks: true,
            }),

            Placeholder.configure({
              placeholder: () => placeholder ?? "Ask sol...",
              includeChildren: true,
            }),
            History,
          ]}
          onCreate={async ({ editor }) => {
            setEditor(editor);
            await new Promise((resolve) => setTimeout(resolve, 100));
            editor.commands.focus("end");
          }}
          onUpdate={({ editor }) => {
            onUpdate(editor);
          }}
          shouldRerenderOnTransaction={false}
          editorProps={{
            attributes: {
              class: `prose prose-lg dark:prose-invert prose-headings:font-title font-default focus:outline-none max-w-full`,
            },
            handleKeyDown(view, event) {
              if (event.key === "Enter" && !event.shiftKey) {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const target = event.target as any;
                if (target.innerHTML.includes("suggestion")) {
                  return false;
                }
                event.preventDefault();
                if (text) {
                  handleSend();
                }
                return true;
              }

              if (event.key === "Enter" && event.shiftKey) {
                view.dispatch(
                  view.state.tr.replaceSelectionWith(
                    view.state.schema.nodes.hardBreak.create(),
                  ),
                );
                return true;
              }
              return false;
            },
          }}
          immediatelyRender={false}
          className={cn(
            "editor-container max-h-[400px] min-h-[40px] w-full min-w-full overflow-auto rounded-lg px-3 text-base",
          )}
        />
      </EditorRoot>
      <div className="mb-1 flex justify-end px-3">
        <Button
          variant="secondary"
          className="gap-1 shadow-none transition-all duration-500 ease-in-out"
          onClick={() => {
            if (!isLoading) {
              handleSend();
            } else {
              stop && stop();
            }
          }}
          size="lg"
        >
          {isLoading ? (
            <>
              <LoaderCircle size={18} className="mr-1 animate-spin" />
              Stop
            </>
          ) : (
            <>Chat</>
          )}
        </Button>
      </div>
    </div>
  );
}
