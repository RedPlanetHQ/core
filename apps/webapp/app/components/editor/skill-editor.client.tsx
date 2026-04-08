import { EditorContent, useEditor } from "@tiptap/react";
import {
  extensionsForConversation,
  getPlaceholder,
} from "../conversation/editor-extensions";
import { Button, Input } from "../ui";
import { Textarea } from "../ui/textarea";
import { DeleteSkillAlert } from "../skills/delete-skill-alert";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";

import React, { useEffect, useRef, useState } from "react";
import { useNavigate } from "@remix-run/react";
import { useToast } from "~/hooks/use-toast";
import { LoaderCircle, Sparkles } from "lucide-react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { AI } from "../icons/ai";

interface Skill {
  id: string;
  title: string | null;
  content: string | null;
  metadata: Record<string, unknown> | null;
  source?: string | null;
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

  const [descIntent, setDescIntent] = useState("");
  const [descOpen, setDescOpen] = useState(false);

  const navigate = useNavigate();
  const { toast } = useToast();

  const existingDescRef = useRef("");

  const { messages, status, sendMessage } = useChat({
    transport: new DefaultChatTransport({
      api: "/api/v1/skills/generate",
      prepareSendMessagesRequest({ messages: msgs }) {
        const lastUser = msgs.findLast((m: any) => m.role === "user");
        const prompt =
          lastUser?.parts?.[0]?.text ?? lastUser?.content ?? "";
        return {
          body: {
            prompt,
            existingDescription: existingDescRef.current || undefined,
          },
        };
      },
    }),
    onError: (err) => {
      toast({
        title: err.message || "Failed to generate",
        variant: "destructive",
      });
    },
  });

  const isGeneratingDesc = status === "streaming" || status === "submitted";
  const completion =
    messages
      .findLast((m) => m.role === "assistant")
      ?.parts?.find((p: any) => p.type === "text")?.text ?? "";

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

  // Live-update editor content as tokens stream in
  useEffect(() => {
    if (completion) {
      editor?.commands.setContent(completion);
    }
  }, [completion, editor]);

  // Close popover only when generation finishes
  useEffect(() => {
    if (!isGeneratingDesc && completion) {
      setDescOpen(false);
      setDescIntent("");
    }
  }, [isGeneratingDesc]);

  const handleGenerateDesc = () => {
    if (!descIntent.trim()) return;
    existingDescRef.current =
      (editor?.storage.markdown.getMarkdown() ?? "").trim();
    sendMessage({ text: descIntent.trim() });
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
    <div className="flex h-[calc(100vh-56px)] w-full max-w-full flex-col items-center space-y-6 pt-3">
      <div className="flex h-full w-full flex-1 flex-col items-center overflow-y-auto">
        <div className="md:min-w-3xl min-w-[0px] max-w-4xl">
          <div>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Skill name"
              className="no-scrollbar text-2xl! mt-5 resize-none overflow-hidden border-0 bg-transparent px-4 py-0 font-medium outline-none focus-visible:ring-0"
            />
          </div>

          <div className="my-5">
            <label className="text-muted-foreground/80 px-4 text-sm">
              Short description
            </label>
            <Textarea
              value={shortDescription}
              onChange={(e) => setShortDescription(e.target.value)}
              placeholder="Brief description of the skill, this is used by the agent to understand the skill"
              className="no-scrollbar min-h-0 resize-none border-0 bg-transparent px-4 py-0 outline-none focus-visible:ring-0"
            />
          </div>

          <div>
            <div className="flex items-center gap-1 px-4">
              <label className="text-muted-foreground/80 text-sm">
                Description
              </label>
              <Popover open={descOpen} onOpenChange={setDescOpen}>
                <PopoverTrigger asChild>
                  <Button variant="ghost" size="xs">
                    <AI className="h-3 w-3" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent
                  className="bg-background-3 w-80 p-3"
                  align="start"
                >
                  <p className="text-muted-foreground mb-2 text-xs">
                    Describe what you need
                  </p>
                  <Textarea
                    value={descIntent}
                    onChange={(e) => setDescIntent(e.target.value)}
                    placeholder="e.g. When I ask for a standup, pull yesterday's GitHub activity and post it to Slack"
                    className="no-scrollbar mb-2 min-h-[80px] resize-none bg-transparent p-0"
                    disabled={isGeneratingDesc}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                        handleGenerateDesc();
                      }
                    }}
                  />
                  <div className="flex justify-end">
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={handleGenerateDesc}
                      disabled={isGeneratingDesc || !descIntent.trim()}
                    >
                      {isGeneratingDesc ? (
                        <>
                          <LoaderCircle className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                          Drafting...
                        </>
                      ) : (
                        "Draft"
                      )}
                    </Button>
                  </div>
                </PopoverContent>
              </Popover>
            </div>
            <EditorContent editor={editor} className="!text-base" />
          </div>
        </div>
      </div>
      <div className="flex w-full justify-between gap-2 border-t border-gray-300 p-2">
        {isEditMode && skill?.source !== "persona-v2" ? (
          <DeleteSkillAlert onDelete={handleDelete} isLoading={isLoading} />
        ) : (
          <div />
        )}
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="lg"
            onClick={() => navigate("/home/agent/skills")}
            disabled={isLoading}
          >
            Cancel
          </Button>
          <Button
            variant="secondary"
            onClick={handleSubmit}
            size="lg"
            isLoading={isLoading}
          >
            {isEditMode ? "Save" : "Create Skill"}
          </Button>
        </div>
      </div>
    </div>
  );
};
