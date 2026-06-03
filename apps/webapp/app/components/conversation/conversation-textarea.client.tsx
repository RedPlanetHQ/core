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
import { AudioLines, LoaderCircle } from "lucide-react";
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

interface ConversationTextareaProps {
  defaultValue?: string;
  placeholder?: string;
  isLoading?: boolean;
  isStopping?: boolean;
  className?: string;
  onChange?: (text: string) => void;
  disabled?: boolean;
  onConversationCreated?: (message: string) => void;
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

  // Keep sendRef current
  const handleSend = useCallback(() => {
    if (!editor || !text || disabled) {
      return;
    }
    onConversationCreated && onConversationCreated(text);
    editor.commands.clearContent(true);
    setText("");
  }, [editor, text, disabled, onConversationCreated]);

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
    <div className="bg-background-3 rounded-xl">
      <EditorContent
        editor={editor}
        className={cn(
          "max-h-[200px] min-h-[48px] w-full overflow-auto px-4 text-base",
          className,
        )}
      />
      <div className="flex items-center justify-between px-2 pb-2 pt-1">
        <div>
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
            disabled={disabled || isStopping}
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
