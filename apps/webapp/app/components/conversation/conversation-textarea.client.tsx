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
import { LoaderCircle } from "lucide-react";
import { useSubmit } from "@remix-run/react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select";

export interface LLMModel {
  id: string;
  modelId: string;
  label: string;
  provider: string;
  isDefault: boolean;
}

interface ConversationTextareaProps {
  defaultValue?: string;
  placeholder?: string;
  isLoading?: boolean;
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
}

export function ConversationTextarea({
  defaultValue,
  isLoading = false,
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
  className,
}: ConversationTextareaProps) {
  const [text, setText] = useState(defaultValue ?? "");
  const submit = useSubmit();

  // Use a ref so the keyboard handler always sees current values without stale closures
  const sendRef = useRef<() => void>(() => {});

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
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const target = event.target as any;
          if (target.innerHTML.includes("suggestion")) {
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

  return (
    <div className="bg-background-3 rounded-xl">
      <EditorContent
        editor={editor}
        className={cn(
          "max-h-[200px] min-h-[48px] w-full overflow-auto px-4 text-base",
          className,
        )}
      />
      <div className="flex items-center justify-between px-3 pb-3 pt-1">
        <div>
          {showModelSelector && (
            <Select value={selectedModelId} onValueChange={onModelChange}>
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
          variant="secondary"
          className="gap-1 shadow-none transition-all duration-500 ease-in-out"
          onClick={() => {
            if (!isLoading && !disabled) {
              handleSend();
            } else if (!disabled) {
              stop && stop();
            }
          }}
          disabled={disabled}
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
