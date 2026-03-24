import { json, redirect, type ActionFunctionArgs, type LoaderFunctionArgs } from "@remix-run/node";
import { useFetcher } from "@remix-run/react";
import { useTypedLoaderData } from "remix-typedjson";
import { requireUser } from "~/services/session.server";
import { prisma } from "~/db.server";
import { OnboardingAgentName } from "~/components/onboarding/onboarding-agent-name";
import { ensureDefaultEmailChannel } from "~/services/channel.server";

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

  if (workspaceId) {
    const existing = await prisma.workspace.findFirst({
      where: { id: workspaceId as string },
      select: { metadata: true },
    });
    const existingMeta = (existing?.metadata ?? {}) as Record<string, unknown>;

    await prisma.workspace.update({
      where: { id: workspaceId as string },
      data: {
        name: agentName,
        slug: agentSlug,
        metadata: { ...existingMeta, onboardingV2Complete: true },
      },
    });

    await ensureDefaultEmailChannel(workspaceId as string, agentSlug);
  }

  return redirect("/onboarding");
}

export default function OnboardingName() {
  const { workspaceId, defaultName, defaultSlug } = useTypedLoaderData<typeof loader>();
  const fetcher = useFetcher();

  const handleComplete = (name: string, slug: string) => {
    fetcher.submit({ agentName: name, agentSlug: slug }, { method: "POST" });
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
