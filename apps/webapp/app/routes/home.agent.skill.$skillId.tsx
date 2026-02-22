import * as React from "react";
import { json, type LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData, useNavigate } from "@remix-run/react";
import { ArrowLeft, Inbox } from "lucide-react";
import { PageHeader } from "~/components/common/page-header";
import { Button, Input } from "~/components/ui";
import { Textarea } from "~/components/ui/textarea";

import { prisma } from "~/db.server";
import { getUser, getWorkspaceId } from "~/services/session.server";
import { useToast } from "~/hooks/use-toast";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const user = await getUser(request);
  const workspaceId = await getWorkspaceId(request, user?.id as string);

  const skill = await prisma.document.findFirst({
    where: {
      id: params.skillId,
      workspaceId: workspaceId as string,
      type: "skill",
      deleted: null,
    },
  });

  return json({ skill });
}

export default function SkillDetail() {
  const { skill } = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [isLoading, setIsLoading] = React.useState(false);
  const [name, setName] = React.useState(skill?.title ?? "");
  const [shortDescription, setShortDescription] = React.useState(
    (skill?.metadata as Record<string, unknown>)?.shortDescription as string ?? ""
  );
  const [content, setContent] = React.useState(skill?.content ?? "");

  if (!skill) {
    return (
      <div className="flex h-full w-full flex-col">
        <PageHeader
          title="Skill"
          actions={[
            {
              label: "Back",
              icon: <ArrowLeft size={14} />,
              onClick: () => navigate("/home/agent/skills"),
              variant: "ghost",
            },
          ]}
        />
        <div className="flex h-[calc(100vh)] flex-col items-center justify-center gap-2 p-4 md:h-[calc(100vh_-_56px)]">
          <Inbox size={30} />
          Skill not found
        </div>
      </div>
    );
  }

  const handleUpdate = async () => {
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
      const response = await fetch(`/api/v1/skills/${skill.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          title: name.trim(),
          content: content.trim(),
          metadata: {
            shortDescription: shortDescription.trim() || undefined,
          },
        }),
      });

      if (!response.ok) {
        throw new Error("Failed to update skill");
      }

      toast({
        title: "Skill updated",
      });
    } catch {
      toast({
        title: "Failed to update skill",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm("Are you sure you want to delete this skill?")) {
      return;
    }

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
    <div className="flex h-full flex-col">
      <PageHeader
        title="Edit Skill"
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

        <div className="flex justify-between">
          <Button
            variant="destructive"
            onClick={handleDelete}
            disabled={isLoading}
          >
            Delete
          </Button>
          <div className="flex gap-3">
            <Button
              variant="ghost"
              onClick={() => navigate("/home/agent/skills")}
              disabled={isLoading}
            >
              Cancel
            </Button>
            <Button
              variant="secondary"
              onClick={handleUpdate}
              isLoading={isLoading}
            >
              Save
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
