import { useState, useRef, useCallback, useEffect } from "react";
import { useLocalCommonState } from "~/hooks/use-local-state";
import { Form, useFetcher, useSubmit } from "@remix-run/react";
import { cn } from "~/lib/utils";
import { ArrowUp, EyeOff } from "lucide-react";
import { Document } from "@tiptap/extension-document";
import HardBreak from "@tiptap/extension-hard-break";
import { History } from "@tiptap/extension-history";
import { Paragraph } from "@tiptap/extension-paragraph";
import { Text } from "@tiptap/extension-text";
import Placeholder from "@tiptap/extension-placeholder";
import { useEditor, EditorContent } from "@tiptap/react";
import { Button } from "../ui";
import { ExampleUseCases } from "./example-usecases";
import { RiGithubFill } from "@remixicon/react";
import { Gmail } from "../icons/gmail";
import { LinearIcon } from "../icons/linear-icon";
import { GoogleCalendar } from "../icons/google-calendar";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select";
import type { LLMModel } from "./conversation-textarea.client";
import Avatar from "boring-avatars";
import { createSkillSlashCommand } from "./slash-command-extension";

export const SUGGESTED = [
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
  name,
  models = [],
  accentColor = "#c87844",
}: {
  user: { name: string | null };
  defaultMessage?: string;
  models?: LLMModel[];
  name: string;
  accentColor?: string;
}) => {
  const [content, setContent] = useState(defaultMessage ?? "");
  const [title, setTitle] = useState(defaultMessage ?? "");
  const [incognito, setIncognito] = useState(false);
  const defaultModelId = models.find((m) => m.isDefault)?.id ?? models[0]?.id;
  const [selectedModelId, setSelectedModelId] = useLocalCommonState<
    string | undefined
  >("selectedModelId", defaultModelId);

  const submit = useSubmit();
  const skillsFetcher = useFetcher<{ skills: Array<{ id: string; title: string }> }>();
  const skillsRef = useRef<Array<{ id: string; title: string }>>([]);

  useEffect(() => {
    skillsFetcher.load("/api/v1/skills?limit=100");
  }, []);

  useEffect(() => {
    skillsRef.current = skillsFetcher.data?.skills ?? [];
  }, [skillsFetcher.data]);

  // Refs so handleKeyDown always sees the latest values without stale closures
  const doSubmitRef = useRef<(messageContent: string) => void>(() => {});
  const contentRef = useRef(defaultMessage ?? "");

  const doSubmit = useCallback(
    (messageContent: string) => {
      submit(
        {
          message: messageContent,
          title: messageContent,
          incognito,
          modelId: selectedModelId ?? "",
        },
        { action: "/home/conversation", method: "post" },
      );
      setContent("");
      setTitle("");
    },
    [incognito, selectedModelId],
  );

  useEffect(() => {
    doSubmitRef.current = doSubmit;
  }, [doSubmit]);

  const editor = useEditor({
    extensions: [
      Placeholder.configure({
        placeholder: () => "ask corebrain...",
        includeChildren: true,
      }),
      Document,
      Paragraph,
      Text,
      HardBreak.configure({ keepMarks: true }),
      History,
      createSkillSlashCommand(skillsRef),
    ],
    immediatelyRender: false,
    autofocus: true,
    editorProps: {
      attributes: {
        class: `prose prose-base dark:prose-invert focus:outline-none max-w-full`,
      },
      handleKeyDown: (_view, event) => {
        if (event.key === "Enter" && !event.shiftKey) {
          event.preventDefault();
          if (contentRef.current.trim()) {
            doSubmitRef.current(contentRef.current);
          }
          return true;
        }
        return false;
      },
    },
    onUpdate({ editor: updatedEditor }) {
      const html = updatedEditor.getHTML();
      setContent(html);
      contentRef.current = html;
      setTitle(updatedEditor.getText());
    },
  });

  // Focus on mount
  useEffect(() => {
    if (editor) {
      const timer = setTimeout(() => {
        editor.commands.focus("end");
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [editor]);

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
      e.preventDefault();
      doSubmit(content);
    },
    [content, doSubmit],
  );

  const handleSubmitClick = useCallback(() => {
    if (!content.trim()) return;
    doSubmit(content);
  }, [content, doSubmit]);

  const showModelSelector = models.length > 1;

  return (
    <Form
      action="/home/conversation"
      method="post"
      onSubmit={(e) => submitForm(e)}
      className="flex h-[calc(100vh_-_56px)] flex-col"
    >
      {/* Centered hero */}
      <div className="flex flex-1 flex-col items-center justify-center gap-3">
        <Avatar
          name={name || "butler"}
          variant="pixel"
          colors={["var(--background-3)", accentColor]}
          size={64}
        />
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
            <EditorContent
              editor={editor}
              className="max-h-[200px] min-h-[48px] w-full overflow-auto px-4 pt-4 text-base"
            />
            <div className="flex items-center justify-between px-3 pb-2 pt-1">
              <div className="flex items-center gap-1">
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
                {showModelSelector && (
                  <Select
                    value={selectedModelId}
                    onValueChange={setSelectedModelId}
                  >
                    <SelectTrigger className="h-8 w-auto min-w-[140px] border-0 bg-transparent text-xs shadow-none focus:ring-0">
                      <SelectValue placeholder="Select model" />
                    </SelectTrigger>
                    <SelectContent>
                      {models.map((model) => (
                        <SelectItem
                          key={model.id}
                          value={model.id}
                          className="text-xs"
                        >
                          <span className="font-medium">{model.label}</span>
                          <span className="text-muted-foreground ml-1 capitalize">
                            · {model.provider}
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>
              <Button
                type="button"
                variant="secondary"
                className="gap-1 rounded"
                onClick={handleSubmitClick}
                disabled={!content.trim()}
              >
                <ArrowUp size={16} />
                {incognito ? "Incognito Chat" : "Chat"}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </Form>
  );
};
