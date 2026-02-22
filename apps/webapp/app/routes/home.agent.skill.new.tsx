import * as React from "react";
import { useNavigate } from "@remix-run/react";
import { ArrowLeft } from "lucide-react";
import { PageHeader } from "~/components/common/page-header";
import { Button, Input } from "~/components/ui";
import { Textarea } from "~/components/ui/textarea";
import { useToast } from "~/hooks/use-toast";


export default function NewSkill() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [isLoading, setIsLoading] = React.useState(false);
  const [name, setName] = React.useState("");
  const [shortDescription, setShortDescription] = React.useState("");
  const [content, setContent] = React.useState("");

  const handleSubmit = async () => {
    if (!name.trim()) {
      toast({
        title: "Name is required",
        variant: "destructive",
      });
      return;
    }

    if (!content.trim()) {
      toast({
        title: "Description is required",
        variant: "destructive",
      });
      return;
    }

    setIsLoading(true);

    try {
      const response = await fetch("/api/v1/skills", {
        method: "POST",
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
        throw new Error("Failed to create skill");
      }

      toast({
        title: "Skill created",
      });

      navigate("/home/agent/skills");
    } catch {
      toast({
        title: "Failed to create skill",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="New Skill"
        actions={[
          {
            label: "Back",
            icon: <ArrowLeft size={14} />,
            onClick: () => navigate("/home/agent/skills"),
            variant: "ghost",
          },
        ]}
      />

      <div className="flex flex-1 flex-col gap-6 p-6">
        <div className="flex flex-col gap-2">
          <label className="text-sm font-medium">Name</label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Enter skill name"
          />
        </div>

        <div className="flex flex-col gap-2">
          <label className="text-sm font-medium">Short Description</label>
          <Input
            value={shortDescription}
            onChange={(e) => setShortDescription(e.target.value)}
            placeholder="Brief description of the skill"
          />
        </div>

        <div className="flex flex-1 flex-col gap-2">
          <label className="text-sm font-medium">Description</label>
          <Textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="Detailed skill instructions and content"
            className="min-h-[200px] flex-1 resize-none"
          />
        </div>

        <div className="flex justify-end gap-3">
          <Button
            variant="ghost"
            onClick={() => navigate("/home/agent/skills")}
            disabled={isLoading}
          >
            Cancel
          </Button>
          <Button
            variant="secondary"
            onClick={handleSubmit}
            isLoading={isLoading}
          >
            Create Skill
          </Button>
        </div>
      </div>
    </div>
  );
}
