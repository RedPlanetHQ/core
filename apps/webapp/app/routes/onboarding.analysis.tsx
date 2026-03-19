import { json, redirect, type ActionFunctionArgs, type LoaderFunctionArgs } from "@remix-run/node";
import { useState } from "react";
import { useFetcher } from "@remix-run/react";
import { requireUser } from "~/services/session.server";
import { storeOnboardingSummary } from "~/models/user.server";
import { addToQueue } from "~/lib/ingest.server";
import { EpisodeType } from "@core/types";
import { prisma } from "~/db.server";
import { getIntegrationAccountBySlugAndUser } from "~/services/integrationAccount.server";
import { OnboardingAgentLoader } from "~/components/onboarding/onboarding-agent-loader";
import { OnboardingStep2 } from "~/components/onboarding/onboarding-step-2";

export async function loader({ request }: LoaderFunctionArgs) {
  const user = await requireUser(request);

  const workspace = user.workspaceId
    ? await prisma.workspace.findFirst({
        where: { id: user.workspaceId as string },
        select: { metadata: true },
      })
    : null;
  const workspaceMeta = (workspace?.metadata ?? {}) as Record<string, unknown>;
  if (!workspaceMeta.onboardingV2Complete) {
    return redirect("/onboarding");
  }

  const gmailAccount = user.workspaceId
    ? await getIntegrationAccountBySlugAndUser("gmail", user.id, user.workspaceId as string)
    : null;
  if (!gmailAccount) {
    return redirect("/onboarding");
  }

  const userMeta = (user.metadata ?? {}) as Record<string, unknown>;
  if (userMeta.onboardingSummary) {
    return redirect("/onboarding/suggestions");
  }

  return json({});
}

export async function action({ request }: ActionFunctionArgs) {
  const { id: userId, workspaceId } = await requireUser(request);
  const formData = await request.formData();
  const summary = formData.get("summary") as string;

  await storeOnboardingSummary(userId, summary);

  if (summary && workspaceId) {
    await addToQueue(
      {
        episodeBody: summary,
        source: "onboarding",
        referenceTime: new Date().toISOString(),
        type: EpisodeType.CONVERSATION,
      },
      userId,
      workspaceId as string,
    );
  }

  return redirect("/onboarding/suggestions");
}

export default function OnboardingAnalysis() {
  const [summary, setSummary] = useState("");
  const [showSummary, setShowSummary] = useState(false);
  const fetcher = useFetcher();
  const [sessionId] = useState(() => crypto.randomUUID());

  const handleAnalysisComplete = (generatedSummary: string) => {
    setSummary(generatedSummary);
    setTimeout(() => setShowSummary(true), 300);
  };

  const handleContinue = () => {
    fetcher.submit({ summary }, { method: "POST" });
  };

  return (
    <>
      {!showSummary && (
        <OnboardingAgentLoader
          sessionId={sessionId}
          onComplete={handleAnalysisComplete}
          className="w-full"
        />
      )}
      {showSummary && (
        <OnboardingStep2
          summary={summary}
          onComplete={handleContinue}
          isCompleting={fetcher.state !== "idle"}
        />
      )}
    </>
  );
}
