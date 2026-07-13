import { Document } from "@tiptap/extension-document";
import HardBreak from "@tiptap/extension-hard-break";
import { History } from "@tiptap/extension-history";
import { Paragraph } from "@tiptap/extension-paragraph";
import { Text } from "@tiptap/extension-text";
import Placeholder from "@tiptap/extension-placeholder";
import { useEditor, EditorContent } from "@tiptap/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "~/lib/utils";
import { Button } from "../ui";
import { Switch } from "../ui/switch";
import { AudioLines, FileText, LoaderCircle, Paperclip, X } from "lucide-react";
import { useSubmit } from "@remix-run/react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select";
import {
  createSkillSlashCommand,
  SkillMention,
  SkillSlashPluginKey,
} from "./slash-command-extension";
import { VoiceComposer } from "~/components/voice/voice-composer";
import type { STTProviderId } from "~/components/voice/stt-providers";
import type { VoiceVadTurnResult } from "~/hooks/use-voice-vad";

export interface LLMModel {
  id: string;
  modelId: string;
  label: string;
  provider: string;
  isDefault: boolean;
}

export type PermissionMode = "default" | "full";

export interface ChatAttachment {
  url: string;
  mediaType: string;
  filename: string;
}

const ATTACHMENT_ACCEPT =
  "image/*,application/pdf,text/*,application/json,application/xml,.csv,.txt,.md,.json,.xml,.yaml,.yml";
const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;

interface ConversationTextareaProps {
  defaultValue?: string;
  placeholder?: string;
  isLoading?: boolean;
  isStopping?: boolean;
  className?: string;
  onChange?: (text: string) => void;
  disabled?: boolean;
  onConversationCreated?: (
    message: string,
    attachments?: ChatAttachment[],
  ) => void;
  stop?: () => void;
  models?: LLMModel[];
  selectedModelId?: string;
  onModelChange?: (modelId: string) => void;
  needsApproval?: boolean;
  leftActions?: React.ReactNode;
  rightActions?: React.ReactNode;
  skills?: Array<{ id: string; title: string }>;
  /**
   * Show the voice mode switch in the composer. When toggled on,
   * the editor area is replaced by a VAD-driven voice composer.
   * Default: true. Pass false for compact contexts (e.g. inline
   * reply popovers) where swapping in a full voice UI is awkward.
   */
  enableVoiceMode?: boolean;
  /** Override the runtime default STT provider. */
  voiceProvider?: STTProviderId;
  /** Controlled voice mode — pair with `onVoiceModeChange`. If omitted,
   *  the textarea manages its own internal voice mode state. */
  voiceMode?: boolean;
  onVoiceModeChange?: (next: boolean) => void;
  /** Fires when VAD detects speech onset — host ducks active TTS. */
  onVoiceSpeechOnset?: () => void;
  /** Fires once per finished turn — host restores or flushes TTS. */
  onVoiceTurnResult?: (result: VoiceVadTurnResult) => void;
}

export function ConversationTextarea({
  defaultValue,
  isLoading = false,
  isStopping = false,
  placeholder,
  onChange,
  onConversationCreated,
  stop,
  needsApproval,
  disabled = false,
  models,
  selectedModelId,
  onModelChange,
  leftActions,
  rightActions,
  className,
  skills,
  enableVoiceMode = true,
  voiceProvider,
  voiceMode: voiceModeProp,
  onVoiceModeChange,
  onVoiceSpeechOnset,
  onVoiceTurnResult,
}: ConversationTextareaProps) {
  const [text, setText] = useState(defaultValue ?? "");
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  const [uploadingCount, setUploadingCount] = useState(0);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [internalVoiceMode, setInternalVoiceMode] = useState(false);
  const voiceMode = voiceModeProp ?? internalVoiceMode;
  const setVoiceMode = (next: boolean) => {
    if (onVoiceModeChange) onVoiceModeChange(next);
    else setInternalVoiceMode(next);
  };
  const submit = useSubmit();

  // Use a ref so the keyboard handler always sees current values without stale closures
  const sendRef = useRef<() => void>(() => {});

  // Skills ref for slash command (updated when skills prop changes)
  const skillsRef = useRef<Array<{ id: string; title: string }>>(skills ?? []);
  useEffect(() => {
    skillsRef.current = skills ?? [];
  }, [skills]);

  const editor = useEditor({
    extensions: [
      Document,
      Paragraph,
      Text,
      HardBreak.configure({
        keepMarks: true,
      }),
      Placeholder.configure({
        placeholder: () =>
          needsApproval
            ? "Waiting for approval..."
            : (placeholder ?? "ask corebrain..."),
        includeChildren: true,
      }),
      History,
      SkillMention,
      createSkillSlashCommand(skillsRef),
    ],
    immediatelyRender: false,
    editorProps: {
      attributes: {
        class: `prose prose-base dark:prose-invert focus:outline-none max-w-full`,
      },
      handleKeyDown(view, event) {
        if (disabled) {
          return true;
        }

        if (event.key === "Enter" && !event.shiftKey) {
          // Let the slash command suggestion handle Enter when active
          const suggestionState = SkillSlashPluginKey.getState(view.state);
          if (suggestionState?.active) {
            return false;
          }
          event.preventDefault();
          sendRef.current();
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
    },
    onUpdate({ editor: updatedEditor }) {
      if (!disabled) {
        setText(updatedEditor.getHTML());
        onChange && onChange(updatedEditor.getText());
      }
    },
  });

  const uploadFile = useCallback(async (file: File) => {
    if (file.size > MAX_ATTACHMENT_BYTES) {
      setUploadError(
        `${file.name} is over ${Math.round(MAX_ATTACHMENT_BYTES / 1024 / 1024)} MB`,
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
      if (!res.ok) {
        throw new Error(`upload failed (${res.status})`);
      }
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
      const arr = Array.from(files);
      arr.forEach((f) => {
        void uploadFile(f);
      });
    },
    [uploadFile],
  );

  const removeAttachment = useCallback((index: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== index));
  }, []);

  // Keep sendRef current
  const handleSend = useCallback(() => {
    if (!editor || disabled) return;
    if (!text && attachments.length === 0) return;
    if (uploadingCount > 0) return;
    onConversationCreated &&
      onConversationCreated(text, attachments.length ? attachments : undefined);
    editor.commands.clearContent(true);
    setText("");
    setAttachments([]);
    setUploadError(null);
  }, [
    editor,
    text,
    disabled,
    attachments,
    uploadingCount,
    onConversationCreated,
  ]);

  useEffect(() => {
    sendRef.current = handleSend;
  }, [handleSend]);

  // Focus on mount
  useEffect(() => {
    if (editor && !disabled) {
      const timer = setTimeout(() => {
        editor.commands.focus("end");
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [editor]);

  // Sync disabled state to editor
  useEffect(() => {
    if (editor) {
      editor.setEditable(!disabled);
    }
  }, [disabled, editor]);

  const showModelSelector = models && models.length > 1 && onModelChange;

  // Voice mode swap: the entire composer body (editor + Chat button)
  // is replaced by a VAD-driven voice composer. The conversation
  // history above the composer stays exactly as it is.
  if (voiceMode) {
    return (
      <VoiceComposer
        enabled={!disabled}
        provider={voiceProvider}
        isAssistantReplying={isLoading || isStopping}
        onSpeechOnset={onVoiceSpeechOnset}
        onTurnResult={onVoiceTurnResult}
        onTranscript={(t) => {
          // Send the transcript through the same path Enter / Chat use,
          // so the hosting page (ConversationView etc.) doesn't need to
          // know voice mode exists.
          if (!t.trim() || disabled) return;
          onConversationCreated?.(t);
        }}
        onClose={() => setVoiceMode(false)}
        className={className}
      />
    );
  }

  return (
    <div
      className="bg-background-3 rounded-xl"
      onDragOver={(e) => {
        if (disabled) return;
        e.preventDefault();
      }}
      onDrop={(e) => {
        if (disabled) return;
        e.preventDefault();
        if (e.dataTransfer?.files?.length) {
          handleFiles(e.dataTransfer.files);
        }
      }}
    >
      {(attachments.length > 0 || uploadingCount > 0 || uploadError) && (
        <div className="flex flex-wrap gap-2 px-3 pt-3">
          {attachments.map((a, i) => (
            <AttachmentChip
              key={`${a.url}-${i}`}
              attachment={a}
              onRemove={() => removeAttachment(i)}
            />
          ))}
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
        className={cn(
          "max-h-[200px] min-h-[48px] w-full overflow-auto px-4 text-base",
          className,
        )}
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
            variant="ghost"
            size="sm"
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={disabled}
            title="Attach image or PDF"
            aria-label="Attach file"
          >
            <Paperclip size={14} />
          </Button>
          {showModelSelector && (
            <Select value={selectedModelId} onValueChange={onModelChange}>
              <SelectTrigger className="h-8 w-auto min-w-[110px] border-0 bg-transparent text-sm shadow-none focus:ring-0">
                <SelectValue placeholder="Select model" />
              </SelectTrigger>
              <SelectContent>
                {models.map((model) => (
                  <SelectItem
                    key={model.id}
                    value={model.id}
                    className="text-sm"
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
        <div className="flex items-center gap-1">
          {enableVoiceMode && (
            <label
              className={cn(
                "text-muted-foreground flex h-8 cursor-pointer items-center gap-1.5 rounded px-2 text-xs",
                "hover:text-foreground transition-colors",
              )}
              title="Voice mode"
            >
              <AudioLines size={13} />
              <Switch
                size="sm"
                checked={false}
                onCheckedChange={(v) => {
                  if (v && !disabled) setVoiceMode(true);
                }}
                aria-label="Voice mode"
              />
            </label>
          )}
          {rightActions}
          <Button
            variant="secondary"
            className="gap-1 shadow-none transition-all duration-500 ease-in-out"
            onClick={() => {
              if (isStopping || disabled) return;
              if (isLoading) {
                stop && stop();
              } else {
                handleSend();
              }
            }}
            disabled={
              disabled ||
              isStopping ||
              (!isLoading && uploadingCount > 0) ||
              (!isLoading && !text && attachments.length === 0)
            }
            size="lg"
          >
            {isStopping ? (
              <>
                <LoaderCircle size={18} className="mr-1 animate-spin" />
                Stopping
              </>
            ) : isLoading ? (
              <>Stop</>
            ) : (
              <>Chat</>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}

function AttachmentChip({
  attachment,
  onRemove,
}: {
  attachment: ChatAttachment;
  onRemove: () => void;
}) {
  const isImage = attachment.mediaType.startsWith("image/");
  return (
    <div className="bg-background-2 border-border flex items-center gap-2 rounded-md border px-2 py-1 text-xs">
      {isImage ? (
        <img
          src={attachment.url}
          alt={attachment.filename}
          className="h-8 w-8 rounded object-cover"
          title={attachment.filename}
        />
      ) : (
        <>
          <FileText size={14} className="text-muted-foreground" />
          <span className="max-w-[160px] truncate" title={attachment.filename}>
            {attachment.filename}
          </span>
        </>
      )}

      <button
        type="button"
        className="text-muted-foreground hover:text-foreground"
        onClick={onRemove}
        aria-label={`Remove ${attachment.filename}`}
      >
        <X size={12} />
      </button>
    </div>
  );
}
