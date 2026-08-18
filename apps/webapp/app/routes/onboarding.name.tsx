import { json, redirect, type ActionFunctionArgs, type LoaderFunctionArgs } from "@remix-run/node";
import { useFetcher } from "@remix-run/react";
import { useTypedLoaderData } from "remix-typedjson";
import type { LoaderData } from "~/utils/loader-data";
import { requireUser } from "~/services/session.server";
import { prisma } from "~/db.server";
import { OnboardingAgentName } from "~/components/onboarding/onboarding-agent-name";
import { ensureDefaultEmailChannel } from "~/services/channel.server";
import {
  ensureGeneralistAgent,
  getGeneralistAgent,
  updateGeneralistAgent,
} from "~/services/agent.server";
import { slugifyHandle } from "~/services/agent-slug";

export async function loader({ request }: LoaderFunctionArgs) {
  const user = await requireUser(request);

  const workspace = user.workspaceId
    ? await prisma.workspace.findFirst({
        where: { id: user.workspaceId as string },
        select: { id: true, name: true, slug: true, metadata: true },
      })
    : null;

  const metadata = (workspace?.metadata ?? {}) as Record<string, unknown>;
  if (metadata.onboardingV2Complete) {
    return redirect("/onboarding");
  }

  return json({
    workspaceId: workspace!.id,
    defaultName: workspace!.name,
    defaultSlug: workspace!.slug,
  });
}

export async function action({ request }: ActionFunctionArgs) {
  const { workspaceId } = await requireUser(request);
  const formData = await request.formData();
  const agentName = formData.get("agentName") as string;
  const agentSlug = formData.get("agentSlug") as string;
  const agentEye = (formData.get("agentEye") as string) || undefined;
  const agentEyeColor = (formData.get("agentEyeColor") as string) || undefined;

  if (workspaceId) {
    const existing = await prisma.workspace.findFirst({
      where: { id: workspaceId as string },
      select: { metadata: true },
    });
    const existingMeta = (existing?.metadata ?? {}) as Record<string, unknown>;
    const nextMeta: Record<string, unknown> = {
      ...existingMeta,
      onboardingV2Complete: true,
    };

    // Workspace name IS the generalist agent's name. Whenever workspace name
    // changes, the generalist syncs (see settings.workspace._index.tsx). The
    // slug drives inbound email routing.
    await prisma.workspace.update({
      where: { id: workspaceId as string },
      data: {
        name: agentName,
        slug: agentSlug,
        metadata: nextMeta,
      },
    });

    // Sync the generalist agent's identity + appearance to the workspace name.
    // Fall back to seeding if a legacy workspace somehow doesn't have one yet.
    const existingGeneralist = await getGeneralistAgent(workspaceId as string);
    if (existingGeneralist) {
      await updateGeneralistAgent(workspaceId as string, {
        displayName: agentName,
        handle: slugifyHandle(agentSlug),
        appearance: {
          ...(agentEye ? { eye: agentEye } : {}),
          ...(agentEyeColor ? { eyeColor: agentEyeColor } : {}),
        },
      });
    } else {
      await ensureGeneralistAgent(workspaceId as string, agentName, {
        handle: agentSlug,
        appearance: {
          ...(agentEye ? { eye: agentEye } : {}),
          ...(agentEyeColor ? { eyeColor: agentEyeColor } : {}),
        },
      });
    }

    await ensureDefaultEmailChannel(workspaceId as string, agentSlug);
  }

  return redirect("/onboarding");
}

export default function OnboardingName() {
  const { workspaceId, defaultName, defaultSlug } = useTypedLoaderData<
    typeof loader
  >() as LoaderData<typeof loader>;
  const fetcher = useFetcher();

  const handleComplete = (
    name: string,
    slug: string,
    agentEye?: string,
  ) => {
    fetcher.submit(
      {
        agentName: name,
        agentSlug: slug,
        ...(agentEye ? { agentEye } : {}),
      },
      { method: "POST" },
    );
  };

  return (
    <div className="flex flex-1 items-center justify-center">
      <OnboardingAgentName
        defaultName={defaultName}
        defaultSlug={defaultSlug}
        workspaceId={workspaceId}
        onComplete={handleComplete}
        isSubmitting={fetcher.state !== "idle"}
      />
    </div>
  );
}
