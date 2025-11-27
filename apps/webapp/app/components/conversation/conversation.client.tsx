import { EditorRoot, EditorContent, Placeholder } from "novel";
import { useState, useRef, useCallback } from "react";
import { Form, useSubmit } from "@remix-run/react";
import { cn } from "~/lib/utils";
import { Document } from "@tiptap/extension-document";
import HardBreak from "@tiptap/extension-hard-break";
import { History } from "@tiptap/extension-history";
import { Paragraph } from "@tiptap/extension-paragraph";
import { Text } from "@tiptap/extension-text";
import { Button } from "../ui";
import { ExampleUseCases } from "./example-usecases";
import { type Editor } from "@tiptap/react";

export const ConversationNew = ({
  user,
}: {
  user: { name: string | null };
}) => {
  const [content, setContent] = useState("");
  const [title, setTitle] = useState("");
  const editorRef = useRef<any>(null);
  const [editor, setEditor] = useState<Editor>();

  const submit = useSubmit();

  // Handle selecting a prompt from examples
  const handleSelectPrompt = useCallback((prompt: string) => {
    editor?.commands.setContent(`<p>${prompt}</p>`);

    setTitle(prompt);
  }, []);

  // Send message to API
  const submitForm = useCallback(
    async (e: React.FormEvent<HTMLFormElement>) => {
      if (!content.trim()) return;

      submit(
        { message: content, title },
        {
          action: "/home/conversation",
          method: "post",
        },
      );
      e.preventDefault();
      setContent("");
      setTitle("");
    },
    [content],
  );

  return (
    <Form
      action="/home/conversation"
      method="post"
      onSubmit={(e) => submitForm(e)}
      className="h-[calc(100vh)] pt-2 md:h-[calc(100vh_-_56px)]"
    >
      <div
        className={cn(
          "flex h-[calc(100vh)] flex-col md:h-[calc(100vh_-_56px)]",
        )}
      >
        <div className="flex h-full w-full flex-col items-center justify-start overflow-y-auto p-4">
          <div className="flex w-full flex-col items-center">
            <div className="w-full max-w-[90ch] pt-[5rem]">
              <h1 className="mx-1 mb-4 text-center text-3xl font-medium">
                What would you like me to remember?
              </h1>

              <div className="bg-background-3 mb-4 rounded-lg border-1 border-gray-300 py-2">
                <EditorRoot>
                  <EditorContent
                    ref={editorRef}
                    autofocus
                    extensions={[
                      Placeholder.configure({
                        placeholder: () => {
                          return "Ask CORE ...";
                        },
                        includeChildren: true,
                      }),
                      Document,
                      Paragraph,
                      Text,
                      HardBreak.configure({
                        keepMarks: true,
                      }),
                      History,
                    ]}
                    onCreate={async ({ editor }) => {
                      setEditor(editor);
                      await new Promise((resolve) => setTimeout(resolve, 100));
                      editor.commands.focus("end");
                    }}
                    editorProps={{
                      attributes: {
                        class: `prose prose-lg dark:prose-invert prose-headings:font-title font-default focus:outline-none max-w-full`,
                      },
                      handleKeyDown: (_view: any, event: KeyboardEvent) => {
                        // This is the ProseMirror event, not React's
                        if (event.key === "Enter" && !event.shiftKey) {
                          event.preventDefault();

                          if (content) {
                            submit(
                              { message: content, title: content },
                              {
                                action: "/home/conversation",
                                method: "post",
                              },
                            );

                            setContent("");
                            setTitle("");
                          }
                          return true;
                        }
                        return false;
                      },
                    }}
                    immediatelyRender={false}
                    className={cn(
                      "editor-container max-h-[400px] min-h-[30px] w-full min-w-full overflow-auto px-3 pt-1 text-base sm:rounded-lg",
                    )}
                    onUpdate={({ editor }: { editor: any }) => {
                      const html = editor.getHTML();
                      const text = editor.getText();
                      setContent(html);
                      setTitle(text);
                    }}
                  />
                </EditorRoot>
                <div className="mb-1 flex justify-end px-3">
                  <Button
                    variant="secondary"
                    className="gap-1 shadow-none transition-all duration-500 ease-in-out"
                    type="submit"
                    size="lg"
                  >
                    Chat
                  </Button>
                </div>
              </div>

              <ExampleUseCases onSelectPrompt={handleSelectPrompt} />
            </div>
          </div>
        </div>
      </div>
    </Form>
  );
};
