import { EditorRoot, EditorContent, Placeholder } from "novel";
import { useState, useRef, useCallback } from "react";
import { Form, useSubmit } from "@remix-run/react";
import { cn } from "~/lib/utils";
import { EyeOff , ArrowUp } from "lucide-react";
import { Document } from "@tiptap/extension-document";
import HardBreak from "@tiptap/extension-hard-break";
import { History } from "@tiptap/extension-history";
import { Paragraph } from "@tiptap/extension-paragraph";
import { Text } from "@tiptap/extension-text";
import { Button } from "../ui";
import { ExampleUseCases } from "./example-usecases";
import { type Editor } from "@tiptap/react";
import Logo from "../logo/logo";
import { RiGithubFill } from "@remixicon/react";
import { Gmail } from "../icons/gmail";
import { LinearIcon } from "../icons/linear-icon";
import { GoogleCalendar } from "../icons/google-calendar";

const SUGGESTED = [
  {
    icon: RiGithubFill,
    prompt:
      "Find the 3 oldest GitHub pull requests waiting for my review and summarize the changes",
  },
  {
    icon: Gmail,
    prompt:
      "Find all unread emails from today, group them by sender importance, and create a prioritized summary with action items",
  },
  {
    icon: LinearIcon,
    prompt:
      "Retrieve all Linear issues assigned to me across all teams, filter by status, and create a prioritized task list with due dates",
  },
  {
    icon: GoogleCalendar,
    prompt:
      "Show all my scheduled events for the next 7 days in chronological order with meeting titles, times, and participants",
  },
];

export const ConversationNew = ({
  user,
  defaultMessage,
}: {
  user: { name: string | null };
  defaultMessage?: string;
}) => {
  const [content, setContent] = useState(defaultMessage ?? "");
  const [title, setTitle] = useState(defaultMessage ?? "");
  const [incognito, setIncognito] = useState(false);
  const editorRef = useRef<any>(null);
  const [editor, setEditor] = useState<Editor>();

  const submit = useSubmit();

  const handleSelectPrompt = useCallback(
    (prompt: string) => {
      const htmlContent = `<p>${prompt}</p>`;
      editor?.commands.setContent(htmlContent);
      setContent(htmlContent);
      setTitle(prompt);
    },
    [editor],
  );

  const submitForm = useCallback(
    async (e: React.FormEvent<HTMLFormElement>) => {
      if (!content.trim()) return;
      submit(
        { message: content, title, incognito },
        { action: "/home/conversation", method: "post" },
      );
      e.preventDefault();
      setContent("");
      setTitle("");
    },
    [content, incognito],
  );

  const handleSubmitClick = useCallback(() => {
    if (!content.trim()) return;
    submit(
      { message: content, title: content, incognito },
      { action: "/home/conversation", method: "post" },
    );
    setContent("");
    setTitle("");
  }, [content, incognito]);

  return (
    <Form
      action="/home/conversation"
      method="post"
      onSubmit={(e) => submitForm(e)}
      className="flex h-[calc(100vh_-_56px)] flex-col"
    >
      {/* Centered hero */}
      <div className="flex flex-1 flex-col items-center justify-center gap-3">
        <Logo size={40} />
        <h1 className="text-3xl font-medium tracking-tight">
          What can I help with?
        </h1>
      </div>

      {/* Suggestions + input pinned to bottom */}
      <div className="flex w-full flex-col items-center px-4 pb-4">
        <div className="w-full max-w-[720px]">
          <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {SUGGESTED.map((item, i) => {
              const Icon = item.icon;
              return (
                <button
                  key={i}
                  type="button"
                  onClick={() => handleSelectPrompt(item.prompt)}
                  className={cn(
                    "hover:bg-background/80 bg-background/50 flex flex-col gap-2 rounded-xl border border-gray-300 p-2 text-left transition-colors",
                  )}
                >
                  <Icon className="h-5 w-5 shrink-0" />
                  <p className="text-muted-foreground line-clamp-2 text-sm">
                    {item.prompt}
                  </p>
                </button>
              );
            })}
          </div>

          {/* Input */}
          <div className="bg-background-3 rounded-xl">
            <EditorRoot>
              <EditorContent
                ref={editorRef}
                autofocus
                extensions={[
                  Placeholder.configure({
                    placeholder: () => "ask corebrain...",
                    includeChildren: true,
                  }),
                  Document,
                  Paragraph,
                  Text,
                  HardBreak.configure({ keepMarks: true }),
                  History,
                ]}
                onCreate={async ({ editor }) => {
                  setEditor(editor);
                  await new Promise((resolve) => setTimeout(resolve, 100));
                  editor.commands.focus("end");
                }}
                editorProps={{
                  attributes: {
                    class: `prose prose-base dark:prose-invert focus:outline-none max-w-full`,
                  },
                  handleKeyDown: (_view: any, event: KeyboardEvent) => {
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      if (content) {
                        submit(
                          { message: content, title: content, incognito },
                          { action: "/home/conversation", method: "post" },
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
                className="max-h-[200px] min-h-[48px] w-full overflow-auto px-4 pt-4 text-base"
                onUpdate={({ editor }: { editor: any }) => {
                  setContent(editor.getHTML());
                  setTitle(editor.getText());
                }}
              />
            </EditorRoot>
            <div className="flex items-center justify-between px-3 pb-3 pt-1">
              <Button
                type="button"
                variant={incognito ? "secondary" : "ghost"}
                size="sm"
                onClick={() => setIncognito((v) => !v)}
                title={
                  incognito
                    ? "Incognito on — not saved to memory"
                    : "Incognito off"
                }
                className="gap-1.5"
              >
                <EyeOff size={13} />
                {incognito && <span>Incognito</span>}
              </Button>
              <Button
                type="button"
                variant="secondary"
                className="gap-1 rounded"
                onClick={handleSubmitClick}
                disabled={!content.trim()}
              >
                <ArrowUp size={16} />
                Chat
              </Button>
            </div>
          </div>
        </div>
      </div>
    </Form>
  );
};
