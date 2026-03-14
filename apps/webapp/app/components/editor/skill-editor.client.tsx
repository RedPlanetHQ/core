import { EditorContent, useEditor } from "@tiptap/react";
import {
  extensionsForConversation,
  getPlaceholder,
} from "../conversation/editor-extensions";
import { Button, Input } from "../ui";
import { Textarea } from "../ui/textarea";
import { DeleteSkillAlert } from "../skills/delete-skill-alert";

import React, { useState } from "react";
import { useNavigate } from "@remix-run/react";
import { useToast } from "~/hooks/use-toast";
import { LoaderCircle } from "lucide-react";

interface Skill {
  id: string;
  title: string | null;
  content: string | null;
  metadata: Record<string, unknown> | null;
}

interface SkillEditorProps {
  skill?: Skill;
}

export const SkillEditor = ({ skill }: SkillEditorProps) => {
  const isEditMode = !!skill;
  const [name, setName] = useState(skill?.title ?? "");
  const [shortDescription, setShortDescription] = useState(
    (skill?.metadata?.shortDescription as string) ?? "",
  );
  const [isLoading, setIsLoading] = useState(false);
  const [intent, setIntent] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);

  const navigate = useNavigate();
  const { toast } = useToast();

  const editor = useEditor({
    extensions: [
      ...extensionsForConversation,
      getPlaceholder("Write detailed skill instructions and content..."),
    ],
    content: skill?.content ?? "",
    editorProps: {
      attributes: {
        class:
          "prose prose-sm focus:outline-none max-w-full min-h-[200px] p-4 py-0",
      },
    },
  });

  const handleGenerate = async () => {
    if (!intent.trim()) {
      toast({
        title: "Please describe what you want this skill to do",
        variant: "destructive",
      });
      return;
    }

    setIsGenerating(true);

    try {
      const response = await fetch("/api/v1/skills/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userIntent: intent.trim() }),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(
          (data as { error?: string }).error || "Failed to generate skill draft",
        );
      }

      const draft = (await response.json()) as {
        title: string;
        shortDescription: string;
        description: string;
      };

      setName(draft.title);
      setShortDescription(draft.shortDescription);
      editor?.commands.setContent(draft.description);
    } catch (err) {
      toast({
        title:
          err instanceof Error ? err.message : "Failed to generate skill draft",
        variant: "destructive",
      });
    } finally {
      setIsGenerating(false);
    }
  };

  const handleSubmit = async () => {
    if (!name.trim()) {
      toast({
        title: "Name is required",
        variant: "destructive",
      });
      return;
    }

    const content = editor?.storage.markdown.getMarkdown();

    if (!content?.trim()) {
      toast({
        title: "Description is required",
        variant: "destructive",
      });
      return;
    }

    setIsLoading(true);

    try {
      const url = isEditMode ? `/api/v1/skills/${skill.id}` : "/api/v1/skills";
      const method = isEditMode ? "PATCH" : "POST";

      const response = await fetch(url, {
        method,
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          title: name.trim(),
          content: content.trim(),
          source: "manual",
          metadata: {
            shortDescription: shortDescription.trim() || undefined,
          },
        }),
      });

      if (!response.ok) {
        throw new Error(`Failed to ${isEditMode ? "update" : "create"} skill`);
      }

      toast({
        title: `Skill ${isEditMode ? "updated" : "created"}`,
      });

      if (!isEditMode) {
        navigate("/home/agent/skills");
      }
    } catch {
      toast({
        title: `Failed to ${isEditMode ? "update" : "create"} skill`,
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!skill) return;

    setIsLoading(true);

    try {
      const response = await fetch(`/api/v1/skills/${skill.id}`, {
        method: "DELETE",
      });

      if (!response.ok) {
        throw new Error("Failed to delete skill");
      }

      toast({
        title: "Skill deleted",
      });

      navigate("/home/agent/skills");
    } catch {
      toast({
        title: "Failed to delete skill",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex h-[calc(100vh)] w-full flex-col items-center space-y-6 pt-3 md:h-[calc(100vh_-_56px)]">
      <div className="flex h-full w-full flex-1 flex-col items-center overflow-y-auto">
        <div className="md:min-w-3xl min-w-[0px] max-w-4xl">
          <div className="mt-5 rounded-lg border border-dashed border-gray-300 p-4">
            <label className="text-muted-foreground/80 mb-1 block text-sm">
              Describe what you want this skill to do
            </label>
            <p className="text-muted-foreground/60 mb-2 text-xs">
              Write in plain language — e.g. "Every morning, summarise my
              unread emails and send a digest to Slack." AI will generate a
              draft you can edit.
            </p>
            <Textarea
              value={intent}
              onChange={(e) => setIntent(e.target.value)}
              placeholder="e.g. When I ask for a standup, pull yesterday's GitHub activity and post it to our Slack channel"
              className="no-scrollbar text-md! min-h-[80px] resize-none border-0 bg-transparent px-0 py-0 outline-none focus-visible:ring-0"
              disabled={isGenerating}
            />
            <div className="mt-2 flex justify-end">
              <Button
                variant="secondary"
                size="sm"
                onClick={handleGenerate}
                disabled={isGenerating || !intent.trim()}
              >
                {isGenerating ? (
                  <>
                    <LoaderCircle className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                    Generating...
                  </>
                ) : (
                  "Generate Draft"
                )}
              </Button>
            </div>
          </div>

          <div>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Skill name"
              className="no-scrollbar text-2xl! mt-5 resize-none overflow-hidden border-0 bg-transparent px-4 py-0 font-medium outline-none focus-visible:ring-0"
            />
          </div>

          <div className="text-md my-5">
            <label className="text-muted-foreground/80 px-4 text-sm">
              Short description
            </label>
            <Textarea
              value={shortDescription}
              onChange={(e) => setShortDescription(e.target.value)}
              placeholder="Brief description of the skill, this is used by the agent to understand the skill"
              className="no-scrollbar text-md! min-h-0 resize-none border-0 bg-transparent px-4 py-0 outline-none focus-visible:ring-0"
            />
          </div>

          <div>
            <label className="text-muted-foreground/80 px-4 text-sm">
              Description
            </label>
            <EditorContent editor={editor} />
          </div>
        </div>
      </div>
      <div className="flex w-full justify-between gap-2 border-t border-gray-300 p-2">
        {isEditMode ? (
          <DeleteSkillAlert onDelete={handleDelete} isLoading={isLoading} />
        ) : (
          <div />
        )}
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="xl"
            onClick={() => navigate("/home/agent/skills")}
            disabled={isLoading}
          >
            Cancel
          </Button>
          <Button
            variant="secondary"
            onClick={handleSubmit}
            size="xl"
            isLoading={isLoading}
          >
            {isEditMode ? "Save" : "Create Skill"}
          </Button>
        </div>
      </div>
    </div>
  );
};
