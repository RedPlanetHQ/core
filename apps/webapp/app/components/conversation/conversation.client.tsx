import { useState, useRef, useCallback, useEffect } from "react";
import { useLocalCommonState } from "~/hooks/use-local-state";
import { Form, useFetcher, useSubmit } from "@remix-run/react";
import { cn } from "~/lib/utils";
import {
  ArrowUp,
  AudioLines,
  EyeOff,
  FileText,
  LoaderCircle,
  Paperclip,
  X,
} from "lucide-react";
import { Switch } from "../ui/switch";
import { VoiceComposer } from "~/components/voice/voice-composer";
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
import type { ChatAttachment, LLMModel } from "./conversation-textarea.client";

const ATTACHMENT_ACCEPT =
  "image/*,application/pdf,text/*,application/json,application/xml,.csv,.txt,.md,.json,.xml,.yaml,.yml";
const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;
import { SamAvatar } from "../ui/sam-avatar";
import {
  createSkillSlashCommand,
  SkillMention,
  SkillSlashPluginKey,
} from "./slash-command-extension";

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
  const [voiceMode, setVoiceMode] = useState(false);
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  const [uploadingCount, setUploadingCount] = useState(0);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const defaultModelId = models.find((m) => m.isDefault)?.id ?? models[0]?.id;
  const [selectedModelId, setSelectedModelId] = useLocalCommonState<
    string | undefined
  >("selectedModelId", defaultModelId);

  const submit = useSubmit();
  const skillsFetcher = useFetcher<{
    skills: Array<{ id: string; title: string }>;
  }>();
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
          // Carry voice mode through the create-and-redirect step. The
          // server action appends ?voice=1 to the redirect URL when
          // this is true so the next page (ConversationView) starts
          // straight in voice mode.
          voiceMode,
          attachments: attachments.length ? JSON.stringify(attachments) : "",
        },
        { action: "/home/conversation", method: "post" },
      );
      setContent("");
      setTitle("");
      setAttachments([]);
    },
    [incognito, selectedModelId, voiceMode, attachments],
  );

  const uploadFile = useCallback(async (file: File) => {
    if (file.size > MAX_ATTACHMENT_BYTES) {
      setUploadError(
        `${file.name} is over ${Math.round(
          MAX_ATTACHMENT_BYTES / 1024 / 1024,
        )} MB`,
      );
      return;
    }
    setUploadError(null);
    setUploadingCount((c) => c + 1);
    try {
      const form = new FormData();
      form.append("File", file);
      const res = await fetch("/api/v1/storage", {
        method: "POST",
        body: form,
        credentials: "include",
      });
      if (!res.ok) throw new Error(`upload failed (${res.status})`);
      const data = (await res.json()) as {
        url?: string;
        filename?: string;
        contentType?: string;
      };
      if (!data.url) throw new Error("no url returned");
      setAttachments((prev) => [
        ...prev,
        {
          url: data.url!,
          filename: data.filename ?? file.name,
          mediaType:
            data.contentType ?? file.type ?? "application/octet-stream",
        },
      ]);
    } catch (e) {
      setUploadError(
        e instanceof Error ? e.message : "upload failed — try again",
      );
    } finally {
      setUploadingCount((c) => c - 1);
    }
  }, []);

  const handleFiles = useCallback(
    (files: FileList | File[]) => {
      Array.from(files).forEach((f) => {
        void uploadFile(f);
      });
    },
    [uploadFile],
  );

  const removeAttachment = useCallback((index: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== index));
  }, []);

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
      SkillMention,
      createSkillSlashCommand(skillsRef),
    ],
    immediatelyRender: false,
    autofocus: true,
    editorProps: {
      attributes: {
        class: `prose prose-base dark:prose-invert focus:outline-none max-w-full`,
      },
      handleKeyDown: (view, event) => {
        if (event.key === "Enter" && !event.shiftKey) {
          const suggestionState = SkillSlashPluginKey.getState(view.state);
          if (suggestionState?.active) {
            return false;
          }

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

  // Set default message content in editor on mount
  useEffect(() => {
    if (editor && defaultMessage) {
      const htmlContent = `<p>${defaultMessage}</p>`;
      editor.commands.setContent(htmlContent);
      setContent(htmlContent);
      setTitle(defaultMessage);
      contentRef.current = htmlContent;
    }
  }, [editor]);

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

  const canSubmit =
    (content.trim().length > 0 || attachments.length > 0) &&
    uploadingCount === 0;

  const submitForm = useCallback(
    async (e: React.FormEvent<HTMLFormElement>) => {
      if (!canSubmit) return;
      e.preventDefault();
      doSubmit(content);
    },
    [canSubmit, content, doSubmit],
  );

  const handleSubmitClick = useCallback(() => {
    if (!canSubmit) return;
    doSubmit(content);
  }, [canSubmit, content, doSubmit]);

  const showModelSelector = models.length > 1;

  return (
    <Form
      action="/home/conversation"
      method="post"
      onSubmit={(e) => submitForm(e)}
      className="h-page flex flex-col"
    >
      {/* Centered hero */}
      <div className="flex flex-1 flex-col items-center justify-center gap-3">
        <SamAvatar size={64} trackCursor />
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
          {voiceMode ? (
            <VoiceComposer
              enabled
              onTranscript={(text) => {
                // Submitting a transcript creates the conversation
                // just like Enter / the Chat button.
                if (!text.trim()) return;
                doSubmit(text);
              }}
              onClose={() => setVoiceMode(false)}
            />
          ) : (
            <div
              className="bg-background-3 rounded-xl"
              onDragOver={(e) => {
                e.preventDefault();
              }}
              onDrop={(e) => {
                e.preventDefault();
                if (e.dataTransfer?.files?.length) {
                  handleFiles(e.dataTransfer.files);
                }
              }}
            >
              {(attachments.length > 0 ||
                uploadingCount > 0 ||
                uploadError) && (
                <div className="flex flex-wrap gap-2 px-3 pt-3">
                  {attachments.map((a, i) => {
                    const isImage = a.mediaType.startsWith("image/");
                    return (
                      <div
                        key={`${a.url}-${i}`}
                        className="bg-background-2 border-border flex items-center gap-2 rounded-md border px-2 py-1 text-xs"
                      >
                        {isImage ? (
                          <img
                            src={a.url}
                            alt={a.filename}
                            title={a.filename}
                            className="h-8 w-8 rounded object-cover"
                          />
                        ) : (
                          <>
                            <FileText
                              size={14}
                              className="text-muted-foreground"
                            />
                            <span
                              className="max-w-[160px] truncate"
                              title={a.filename}
                            >
                              {a.filename}
                            </span>
                          </>
                        )}
                        <button
                          type="button"
                          className="text-muted-foreground hover:text-foreground"
                          onClick={() => removeAttachment(i)}
                          aria-label={`Remove ${a.filename}`}
                        >
                          <X size={12} />
                        </button>
                      </div>
                    );
                  })}
                  {uploadingCount > 0 && (
                    <div className="text-muted-foreground flex items-center gap-2 rounded-md border border-dashed px-2 py-1 text-xs">
                      <LoaderCircle size={12} className="animate-spin" />
                      Uploading…
                    </div>
                  )}
                  {uploadError && (
                    <div className="text-destructive flex items-center gap-2 rounded-md border border-dashed border-red-300 px-2 py-1 text-xs">
                      {uploadError}
                    </div>
                  )}
                </div>
              )}
              <EditorContent
                editor={editor}
                className="max-h-[200px] min-h-[48px] w-full overflow-auto px-4 pt-4 text-base"
              />
              <input
                ref={fileInputRef}
                type="file"
                accept={ATTACHMENT_ACCEPT}
                multiple
                className="hidden"
                onChange={(e) => {
                  if (e.target.files?.length) handleFiles(e.target.files);
                  e.target.value = "";
                }}
              />
              <div className="flex items-center justify-between px-2 pb-2 pt-1">
                <div className="flex items-center gap-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => fileInputRef.current?.click()}
                    title="Attach file"
                    aria-label="Attach file"
                  >
                    <Paperclip size={14} />
                  </Button>
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
                      <SelectTrigger className="h-8 w-auto min-w-[110px] border-0 bg-transparent text-xs shadow-none focus:ring-0">
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
                <div className="flex items-center gap-2">
                  <label
                    className="text-muted-foreground hover:text-foreground flex h-8 cursor-pointer items-center gap-1.5 rounded px-2 text-xs transition-colors"
                    title="Voice mode"
                  >
                    <AudioLines size={13} />
                    <Switch
                      size="sm"
                      checked={false}
                      onCheckedChange={(v) => {
                        if (v) setVoiceMode(true);
                      }}
                      aria-label="Voice mode"
                    />
                  </label>
                  <Button
                    type="button"
                    variant="secondary"
                    className="gap-1 rounded"
                    onClick={handleSubmitClick}
                    disabled={!canSubmit}
                  >
                    <ArrowUp size={16} />
                    {incognito ? "Incognito Chat" : "Chat"}
                  </Button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </Form>
  );
};
