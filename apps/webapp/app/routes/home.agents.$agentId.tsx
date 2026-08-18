import { useState } from "react";
import { json, type LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData, useNavigate } from "@remix-run/react";
import { Trash2 } from "lucide-react";
import { requireUser } from "~/services/session.server";
import { PageHeader } from "~/components/common/page-header";
import { Button } from "~/components/ui";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "~/components/ui/alert-dialog";
import { Card, CardContent } from "~/components/ui/card";
import {
  AgentForm,
  type AgentFormValue,
  type AgentKind,
  type PersonalityChoice,
} from "~/components/agent/agent-form";
import {
  classifyAgent,
  getAgentById,
  readAgentAppearance,
} from "~/services/agent.server";
import { PERSONALITY_OPTIONS } from "~/services/agent/prompts/personality";
import { getCustomPersonalities } from "~/models/personality.server";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { workspaceId } = await requireUser(request);
  if (!workspaceId) throw new Response("Unauthorized", { status: 401 });
  const agentId = params.agentId;
  if (!agentId) throw new Response("agentId required", { status: 400 });

  const agent = await getAgentById(workspaceId as string, agentId);
  if (!agent) throw new Response("Not found", { status: 404 });

  const appearance = readAgentAppearance(agent);
  const custom = await getCustomPersonalities(workspaceId as string);
  const personalities: PersonalityChoice[] = [
    ...PERSONALITY_OPTIONS.map((p) => ({
      id: p.id,
      name: p.name,
      description: p.description,
    })),
    ...custom.map((c) => ({ id: c.id, name: c.name })),
  ];
  return json({
    agent: {
      id: agent.id,
      handle: agent.handle,
      displayName: agent.displayName,
      basePrompt: agent.basePrompt,
      personality: agent.personality,
      status: agent.status,
      kind: classifyAgent(agent) as AgentKind,
    },
    appearance,
    personalities,
  });
}

export default function EditAgent() {
  const { agent, appearance, personalities } = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);

  const initial: AgentFormValue = {
    displayName: agent.displayName,
    handle: agent.handle,
    basePrompt: agent.basePrompt,
    personality: agent.personality ?? "tars",
    eye: appearance.eye,
    eyeColor: appearance.eyeColor,
  };

  const handleSubmit = async (value: AgentFormValue) => {
    setError(null);
    setIsSubmitting(true);
    try {
      const payload: Record<string, unknown> = {
        basePrompt: value.basePrompt,
        personality: value.personality,
        appearance: {
          eye: value.eye,
          eyeColor: value.eyeColor,
        },
      };
      if (agent.kind === "user") {
        payload.displayName = value.displayName;
        payload.handle = value.handle;
      }
      const res = await fetch(`/api/v1/agents/${agent.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = (await res.json()) as { error?: string };
      if (!res.ok) {
        setError(body.error ?? "Failed to save agent");
        return;
      }
      navigate(".", { replace: true });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save agent");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async () => {
    setIsDeleting(true);
    try {
      const res = await fetch(`/api/v1/agents/${agent.id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const body = (await res.json()) as { error?: string };
        setError(body.error ?? "Failed to delete agent");
        setIsDeleteOpen(false);
        return;
      }
      navigate("/home/conversation");
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title={agent.displayName}
        breadcrumbs={[
          { label: "Agents", href: "/home/agents" },
          { label: agent.displayName },
        ]}
      />
      <div className="flex-1 overflow-y-auto">
        <AgentForm
          mode="edit"
          kind={agent.kind}
          initial={initial}
          personalities={personalities}
          submitLabel="Save"
          onSubmit={handleSubmit}
          error={error}
          isSubmitting={isSubmitting}
        />

        {agent.kind !== "system" && (
          <div className="md:w-3xl mx-auto flex w-auto flex-col gap-4 px-4 pb-8">
            <h2 className="text-md">Danger Zone</h2>
            <Card className="border-destructive/50">
              <CardContent className="p-3">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium">
                      {agent.kind === "gateway"
                        ? "Archive this gateway agent"
                        : "Delete this agent"}
                    </p>
                    <p className="text-muted-foreground text-sm">
                      {agent.kind === "gateway"
                        ? "Removes the agent surface. The underlying gateway isn't touched."
                        : "This will permanently remove the agent."}
                    </p>
                  </div>
                  <AlertDialog
                    open={isDeleteOpen}
                    onOpenChange={setIsDeleteOpen}
                  >
                    <AlertDialogTrigger asChild>
                      <Button variant="destructive" size="lg">
                        <Trash2 size={16} className="mr-2" />
                        {agent.kind === "gateway" ? "Archive" : "Delete"}
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>
                          {agent.kind === "gateway"
                            ? "Archive gateway agent"
                            : "Delete agent"}
                        </AlertDialogTitle>
                        <AlertDialogDescription>
                          {agent.kind === "gateway"
                            ? `The "${agent.displayName}" agent will be archived. Reconnect the gateway to bring it back.`
                            : `The "${agent.displayName}" agent will be permanently removed.`}
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <Button
                          variant="destructive"
                          onClick={handleDelete}
                          disabled={isDeleting}
                        >
                          {isDeleting
                            ? "Working..."
                            : agent.kind === "gateway"
                              ? "Archive"
                              : "Delete"}
                        </Button>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </div>
  );
}
