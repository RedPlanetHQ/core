import { useFetcher, useNavigate } from "@remix-run/react";
import {
  type ActionFunctionArgs,
  json,
  type LoaderFunctionArgs,
  redirect,
} from "@remix-run/node";
import { requireUser } from "~/services/session.server";
import { updateUser } from "~/models/user.server";
import Logo from "~/components/logo/logo";
import { useState } from "react";
import { OnboardingAgentLoader } from "~/components/onboarding/onboarding-agent-loader";
import { OnboardingAgentName } from "~/components/onboarding/onboarding-agent-name";
import { OnboardingStep2 } from "~/components/onboarding/onboarding-step-2";
import { addToQueue } from "~/lib/ingest.server";
import { EpisodeType } from "@core/types";
import { Button } from "~/components/ui";
import { useTypedLoaderData } from "remix-typedjson";
import { getIntegrationAccountBySlugAndUser } from "~/services/integrationAccount.server";
import { getIntegrationDefinitionWithSlug } from "~/services/integrationDefinition.server";
import { getRedirectURL } from "~/services/oauth/oauth.server";
import { prisma } from "~/db.server";
import { documentsPath } from "~/utils/pathBuilder";

// ---------------------------------------------------------------------------
// Loader — derive step from DB state
// ---------------------------------------------------------------------------
export async function loader({ request }: LoaderFunctionArgs) {
  const user = await requireUser(request);

  if (user.onboardingComplete) {
    return redirect(documentsPath());
  }

  const url = new URL(request.url);
  const redirectTo = url.searchParams.get("redirectTo") ?? null;

  const workspace = user.workspaceId
    ? await prisma.workspace.findFirst({
        where: { id: user.workspaceId as string },
        select: { id: true, name: true, slug: true, metadata: true },
      })
    : null;

  const metadata = (workspace?.metadata ?? {}) as Record<string, unknown>;

  // Step 1: agent name — always first, until user sets it
  if (!metadata.agentEnabled) {
    return json({
      step: "agent_name" as const,
      redirectTo,
      gmailOAuthUrl: null,
      workspaceId: workspace!.id,
      defaultName: workspace!.name,
      defaultSlug: workspace!.slug,
    });
  }

  // Step 2: Gmail connect (only for users without Gmail)
  const gmailAccount = workspace
    ? await getIntegrationAccountBySlugAndUser("gmail", user.id, workspace.id)
    : null;

  if (!gmailAccount) {
    const gmailIntegration = await getIntegrationDefinitionWithSlug("gmail");
    let gmailOAuthUrl = null;
    if (gmailIntegration && workspace) {
      const redirectBack = redirectTo
        ? `${url.origin}/onboarding?redirectTo=${encodeURIComponent(redirectTo)}`
        : `${url.origin}/onboarding`;
      gmailOAuthUrl = await getRedirectURL(
        {
          integrationDefinitionId: gmailIntegration.id,
          redirectURL: redirectBack,
        },
        user.id,
        workspace.id,
      );
    }
    return json({
      step: "gmail_connect" as const,
      redirectTo,
      gmailOAuthUrl,
      workspaceId: workspace!.id,
      defaultName: workspace!.name,
      defaultSlug: workspace!.slug,
    });
  }

  // Step 3: Gmail connected — run analysis
  return json({
    step: "analysis" as const,
    redirectTo,
    gmailOAuthUrl: null,
    workspaceId: workspace!.id,
    defaultName: workspace!.name,
    defaultSlug: workspace!.slug,
  });
}

// ---------------------------------------------------------------------------
// Action
// ---------------------------------------------------------------------------
export async function action({ request }: ActionFunctionArgs) {
  const { id: userId, workspaceId } = await requireUser(request);
  const formData = await request.formData();
  const intent = formData.get("intent") as string;

  // Save agent name → update workspace, mark agentEnabled
  if (intent === "save_agent_name") {
    const agentName = formData.get("agentName") as string;
    const agentSlug = formData.get("agentSlug") as string;

    if (workspaceId) {
      const existing = await prisma.workspace.findFirst({
        where: { id: workspaceId as string },
        select: { metadata: true },
      });
      const existingMeta = (existing?.metadata ?? {}) as Record<
        string,
        unknown
      >;

      await prisma.workspace.update({
        where: { id: workspaceId as string },
        data: {
          name: agentName,
          slug: agentSlug,
          metadata: { ...existingMeta, agentEnabled: true },
        },
      });
    }

    return redirect("/onboarding");
  }

  // Skip Gmail → complete onboarding immediately
  if (intent === "skip") {
    const redirectTo = formData.get("redirectTo") as string | null;
    await updateUser({ id: userId, onboardingComplete: true, metadata: {} });
    return redirect(redirectTo || "/home/memory/documents");
  }

  // Complete after analysis
  if (intent === "complete") {
    const summary = formData.get("summary") as string;
    const redirectTo = formData.get("redirectTo") as string | null;

    await updateUser({
      id: userId,
      onboardingComplete: true,
      metadata: { onboardingSummary: summary },
    });

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

    return redirect(redirectTo || "/home/integrations");
  }

  return json({ error: "unknown intent" }, { status: 400 });
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export default function Onboarding() {
  const {
    step,
    redirectTo,
    gmailOAuthUrl,
    workspaceId,
    defaultName,
    defaultSlug,
  } = useTypedLoaderData<typeof loader>() as any;

  const fetcher = useFetcher();
  const [summary, setSummary] = useState("");
  const [showSummary, setShowSummary] = useState(false);
  const [sessionId] = useState(() => crypto.randomUUID());

  const isSubmitting = fetcher.state !== "idle";

  const handleAgentNameSubmit = (name: string, slug: string) => {
    fetcher.submit(
      { intent: "save_agent_name", agentName: name, agentSlug: slug },
      { method: "POST" },
    );
  };

  const handleSkip = () => {
    fetcher.submit(
      { intent: "skip", redirectTo: redirectTo ?? "" },
      { method: "POST" },
    );
  };

  const handleAnalysisComplete = (generatedSummary: string) => {
    setSummary(generatedSummary);
    setTimeout(() => setShowSummary(true), 300);
  };

  const handleComplete = () => {
    fetcher.submit(
      { intent: "complete", summary, redirectTo: redirectTo ?? "" },
      { method: "POST" },
    );
  };

  return (
    <div className="flex h-[100vh] w-[100vw] flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-6 md:px-10">
        <div className="flex items-center gap-2 py-4">
          <div className="flex size-8 items-center justify-center rounded-md">
            <Logo size={60} />
          </div>
          <span className="font-mono font-medium">C.O.R.E.</span>
        </div>
        {step === "gmail_connect" && (
          <Button variant="ghost" onClick={handleSkip} disabled={isSubmitting}>
            skip
          </Button>
        )}
      </div>

      {/* Main Content */}
      <div className="flex flex-1 items-center justify-center overflow-y-auto">
        {/* Step 1: name your agent */}
        {step === "agent_name" && (
          <OnboardingAgentName
            defaultName={defaultName}
            defaultSlug={defaultSlug}
            workspaceId={workspaceId}
            onComplete={handleAgentNameSubmit}
            isSubmitting={isSubmitting}
          />
        )}

        {/* Step 2: connect Gmail */}
        {step === "gmail_connect" && (
          <div className="flex max-w-lg flex-col gap-6 p-6">
            <div className="space-y-3">
              <h2 className="text-xl font-semibold">i'm {defaultName}.</h2>
              <div className="text-muted-foreground space-y-2 text-base">
                <p>
                  connect gmail and i'll learn about you — who you work with,
                  what you're building, what matters.
                </p>
                <p>
                  takes a minute. makes everything better. or skip and i'll
                  learn as we go.
                </p>
              </div>
            </div>
            <div className="flex justify-end gap-3">
              <Button
                size="lg"
                variant="ghost"
                onClick={handleSkip}
                disabled={isSubmitting}
              >
                Skip
              </Button>
              {gmailOAuthUrl?.redirectURL && (
                <Button
                  size="lg"
                  variant="secondary"
                  onClick={() => {
                    window.location.href = gmailOAuthUrl.redirectURL;
                  }}
                >
                  Connect Gmail
                </Button>
              )}
            </div>
          </div>
        )}

        {/* Step 3: analysis + summary */}
        {step === "analysis" && (
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
                onComplete={handleComplete}
                isCompleting={isSubmitting}
              />
            )}
          </>
        )}
      </div>
    </div>
  );
}
