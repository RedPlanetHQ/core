import { useState, useEffect } from "react";
import { useFetcher } from "@remix-run/react";
import { EditorContent, useEditor } from "@tiptap/react";
import { Sparkles } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Switch } from "~/components/ui/switch";
import { Label } from "~/components/ui/label";
import {
  extensionsForConversation,
  getPlaceholder,
} from "~/components/conversation/editor-extensions";
import { type CustomPersonality } from "~/models/personality.server";
import { Checkbox } from "../ui/checkbox";
import { AI } from "../icons/ai";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  existing: CustomPersonality | null;
}

export function CustomPersonalityDialog({
  open,
  onOpenChange,
  existing,
}: Props) {
  const fetcher = useFetcher<{
    success?: boolean;
    improved?: { text: string };
  }>();

  const [name, setName] = useState(existing?.name ?? "");
  const [useHonorifics, setUseHonorifics] = useState(
    existing?.useHonorifics ?? false,
  );

  const editor = useEditor({
    extensions: [
      ...extensionsForConversation,
      getPlaceholder(
        "Describe how the butler should talk — tone, style, what they never say...",
      ),
    ],
    content: existing?.text ?? "",
    editorProps: {
      attributes: {
        class:
          "prose prose-sm focus:outline-none max-w-full min-h-[200px] p-4 py-2",
      },
    },
  });

  const isImproving =
    fetcher.state !== "idle" &&
    fetcher.formData?.get("intent") === "improvePersonality";
  const isSaving =
    fetcher.state !== "idle" &&
    fetcher.formData?.get("intent") === "createPersonality";

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.improved) {
      editor?.commands.setContent(fetcher.data.improved.text);
    }
  }, [fetcher.state, fetcher.data, editor]);

  const handleImprove = () => {
    const text =
      editor?.storage.markdown?.getMarkdown() ?? editor?.getText() ?? "";
    if (!name || !text) return;
    fetcher.submit(
      { intent: "improvePersonality", name, text },
      { method: "POST" },
    );
  };

  const handleSave = () => {
    const text =
      editor?.storage.markdown?.getMarkdown() ?? editor?.getText() ?? "";
    if (!name || !text) return;
    const id = existing?.id ?? name.toLowerCase().replace(/\s+/g, "-");
    fetcher.submit(
      {
        intent: "createPersonality",
        personality: JSON.stringify({ id, name, text, useHonorifics }),
      },
      { method: "POST" },
    );
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {existing ? "Edit personality" : "Create your own personality"}
          </DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div>
            <Label className="mb-1 block text-sm">Name</Label>
            <Input
              placeholder="e.g. Jarvis, Samantha, Max"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          <div>
            <div className="mb-1 flex items-center justify-between">
              <Label className="text-sm">Personality</Label>
              <Button
                size="sm"
                variant="ghost"
                onClick={handleImprove}
                disabled={isImproving}
                className="gap-1.5 text-xs"
              >
                <AI className="h-3 w-3" />
                {isImproving ? "Improving..." : "Improve with AI"}
              </Button>
            </div>
            <div className="border-input rounded-md border">
              <EditorContent editor={editor} className="!text-sm" />
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Checkbox
              id="honorifics"
              checked={useHonorifics}
              onCheckedChange={(checked) =>
                setUseHonorifics(checked as boolean)
              }
            />
            <Label htmlFor="honorifics" className="text-sm">
              Use honorifics (sir / ma'am)
            </Label>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              variant="secondary"
              onClick={handleSave}
              disabled={!name || isSaving}
            >
              {isSaving ? "Saving..." : "Save personality"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
