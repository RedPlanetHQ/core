import { useState } from "react";
import { json, type LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData, useNavigate } from "@remix-run/react";
import { requireUser } from "~/services/session.server";
import { PageHeader } from "~/components/common/page-header";
import {
  AgentForm,
  defaultAgentFormValue,
  type AgentFormValue,
  type PersonalityChoice,
} from "~/components/agent/agent-form";
import { SPECIALIST_BASE_PROMPT } from "~/services/agent-prompts";
import { PERSONALITY_OPTIONS } from "~/services/agent/prompts/personality";
import { getCustomPersonalities } from "~/models/personality.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const { workspaceId } = await requireUser(request);
  if (!workspaceId) throw new Response("Unauthorized", { status: 401 });

  const custom = await getCustomPersonalities(workspaceId as string);
  const personalities: PersonalityChoice[] = [
    ...PERSONALITY_OPTIONS.map((p) => ({
      id: p.id,
      name: p.name,
      description: p.description,
    })),
    ...custom.map((c) => ({ id: c.id, name: c.name })),
  ];
  return json({ personalities });
}

export default function NewAgent() {
  const { personalities } = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const initial: AgentFormValue = {
    ...defaultAgentFormValue(),
    basePrompt: SPECIALIST_BASE_PROMPT,
  };

  const handleSubmit = async (value: AgentFormValue) => {
    setError(null);
    setIsSubmitting(true);
    try {
      const res = await fetch("/api/v1/agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          displayName: value.displayName,
          handle: value.handle,
          basePrompt: value.basePrompt,
          personality: value.personality,
          appearance: {
            eye: value.eye,
            eyeColor: value.eyeColor,
          },
        }),
      });
      const body = (await res.json()) as {
        agent?: { id: string };
        error?: string;
      };
      if (!res.ok || !body.agent) {
        setError(body.error ?? "Failed to create agent");
        return;
      }
      navigate(`/home/agents/${body.agent.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create agent");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="New agent"
        breadcrumbs={[
          { label: "Agents", href: "/home/agents" },
          { label: "New" },
        ]}
      />
      <div className="flex-1 overflow-y-auto">
        <AgentForm
          mode="create"
          kind="user"
          initial={initial}
          personalities={personalities}
          submitLabel="Create agent"
          onSubmit={handleSubmit}
          error={error}
          isSubmitting={isSubmitting}
        />
      </div>
    </div>
  );
}
