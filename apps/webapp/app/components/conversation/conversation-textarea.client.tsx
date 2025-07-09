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
import { Loader } from "lucide-react";
import { Form, useSubmit } from "@remix-run/react";

interface ConversationTextareaProps {
  defaultValue?: string;
  conversationId: string;
  placeholder?: string;
  isLoading?: boolean;
  className?: string;
  onChange?: (text: string) => void;
  disabled?: boolean;
}

export function ConversationTextarea({
  defaultValue,
  isLoading = false,
  placeholder,
  className,
  conversationId,
  onChange,
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

    const data = isLoading ? {} : { message: text, conversationId };

    submit(data as any, {
      action: isLoading
        ? `/home/conversation/${conversationId}`
        : "/home/conversation",
      method: "post",
    });

    editor?.commands.clearContent(true);
    setText("");

    editor.commands.clearContent(true);
    setText("");
  }, [editor, text]);

  // Send message to API
  const submitForm = useCallback(
    async (e: React.FormEvent<HTMLFormElement>) => {
      const data = isLoading
        ? {}
        : { message: text, title: text, conversationId };

      submit(data as any, {
        action: isLoading
          ? `/home/conversation/${conversationId}`
          : "/home/conversation",
        method: "post",
      });

      editor?.commands.clearContent(true);
      setText("");
      e.preventDefault();
    },
    [text, conversationId],
  );

  return (
    <Form
      action="/home/conversation"
      method="post"
      onSubmit={(e) => submitForm(e)}
      className="pt-2"
    >
      <div className="bg-background-3 rounded py-2">
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
              "editor-container text-md max-h-[400px] min-h-[40px] w-full min-w-full overflow-auto px-3 sm:rounded-lg",
            )}
          />
        </EditorRoot>
        <div className="flex justify-end px-3">
          <Button
            variant="default"
            className="gap-1 shadow-none transition-all duration-500 ease-in-out"
            type="submit"
            size="lg"
          >
            {isLoading ? (
              <>
                <Loader size={18} className="mr-1 animate-spin" />
                Stop
              </>
            ) : (
              <>Chat</>
            )}
          </Button>
        </div>
      </div>
    </Form>
  );
}
