import {
  json,
  redirect,
  type ActionFunctionArgs,
  type LoaderFunctionArgs,
} from "@remix-run/node";
import { useFetcher } from "@remix-run/react";
import { useTypedLoaderData } from "remix-typedjson";
import { requireUser } from "~/services/session.server";
import { prisma } from "~/db.server";
import {
  OnboardingAgentName,
  type CustomPersonalityData,
} from "~/components/onboarding/onboarding-agent-name";
import { ensureDefaultEmailChannel } from "~/services/channel.server";
import { saveCustomPersonality } from "~/models/personality.server";
import { env } from "~/env.server";
import { deriveEmailDomain } from "~/utils/onboarding-email";

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
    emailDomain: deriveEmailDomain(env.LOGIN_ORIGIN),
    userName: user.displayName ?? user.name ?? user.email ?? "",
  });
}

export async function action({ request }: ActionFunctionArgs) {
  const user = await requireUser(request);
  const { workspaceId } = user;
  const formData = await request.formData();

  const agentName = formData.get("agentName") as string;
  const agentSlug = formData.get("agentSlug") as string;
  const personalityId = formData.get("personalityId") as string;
  const customPersonalityRaw = formData.get("customPersonality") as
    | string
    | null;

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

    // Save personality selection to user metadata
    if (personalityId) {
      const currentUserMeta = (user.metadata as Record<string, unknown>) ?? {};
      await prisma.user.update({
        where: { id: user.id },
        data: {
          metadata: { ...currentUserMeta, personality: personalityId },
        },
      });

      // If custom personality data is provided, persist it to workspace
      if (customPersonalityRaw) {
        const customData: CustomPersonalityData = JSON.parse(customPersonalityRaw);
        await saveCustomPersonality(workspaceId as string, {
          id: personalityId,
          name: customData.name,
          text: customData.text,
          useHonorifics: customData.useHonorifics,
        });
      }
    }

    await ensureDefaultEmailChannel(workspaceId as string, agentSlug);
  }

  return redirect("/onboarding");
}

export default function OnboardingName() {
  const { workspaceId, defaultName, defaultSlug, emailDomain, userName } =
    useTypedLoaderData<typeof loader>();
  const fetcher = useFetcher();

  const handleComplete = (
    name: string,
    slug: string,
    personalityId: string,
    customPersonality?: CustomPersonalityData,
  ) => {
    fetcher.submit(
      {
        agentName: name,
        agentSlug: slug,
        personalityId,
        ...(customPersonality
          ? { customPersonality: JSON.stringify(customPersonality) }
          : {}),
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
        emailDomain={emailDomain}
        userName={userName}
        onComplete={handleComplete}
        isSubmitting={fetcher.state !== "idle"}
      />
    </div>
  );
}
