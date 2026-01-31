import { useNavigate, useFetcher } from "@remix-run/react";
import {
  type ActionFunctionArgs,
  json,
  type LoaderFunctionArgs,
  redirect,
} from "@remix-run/node";
import { requireUser, requireUserId } from "~/services/session.server";
import { updateUser } from "~/models/user.server";
import Logo from "~/components/logo/logo";
import { useState, useEffect } from "react";
import { OnboardingAgentLoader } from "~/components/onboarding/onboarding-agent-loader";
import { OnboardingStep2 } from "~/components/onboarding/onboarding-step-2";
import { addToQueue } from "~/lib/ingest.server";
import { EpisodeType } from "@core/types";

import { Button } from "~/components/ui";
import { useTypedLoaderData } from "remix-typedjson";
import { getIntegrationAccountBySlugAndUser } from "~/services/integrationAccount.server";
import { getIntegrationDefinitionWithSlug } from "~/services/integrationDefinition.server";
import { getRedirectURL } from "~/services/oauth/oauth.server";
import { getWorkspaceByUser } from "~/models/workspace.server";
import { episodesPath } from "~/utils/pathBuilder";

export async function loader({ request }: LoaderFunctionArgs) {
  const user = await requireUser(request);

  // Check if Gmail is connected
  const gmailAccount = await getIntegrationAccountBySlugAndUser(
    "gmail",
    user.id,
  );

  // Get Gmail integration definition
  const gmailIntegration = await getIntegrationDefinitionWithSlug("gmail");

  // Get OAuth redirect URL only if Gmail is not connected
  let gmailOAuthUrl = null;
  if (!gmailAccount && gmailIntegration) {
    const workspace = await getWorkspaceByUser(user.id);
    gmailOAuthUrl = await getRedirectURL(
      {
        integrationDefinitionId: gmailIntegration.id,
        redirectURL: `${new URL(request.url).origin}/onboarding`,
      },
      user.id,
      workspace?.id,
    );
  }

  if (user.onboardingComplete) {
    return redirect(episodesPath());
  }

  return {
    user,
    hasGmail: !!gmailAccount,
    gmailOAuthUrl,
  };
}

export async function action({ request }: ActionFunctionArgs) {
  const userId = await requireUserId(request);
  const formData = await request.formData();
  const summary = formData.get("summary") as string;

  try {
    // Update user's onboarding status
    await updateUser({
      id: userId,
      onboardingComplete: true,
      metadata: {
        onboardingSummary: summary,
      },
    });

    if (summary) {
      // Ingest the summary as a document
      await addToQueue(
        {
          episodeBody: summary,
          source: "onboarding",
          referenceTime: new Date().toISOString(),
          type: EpisodeType.CONVERSATION,
        },
        userId,
      );
    }

    // Redirect to integrations if summary exists (normal flow)
    // or to episodes if skipped (no summary)
    return redirect(summary ? "/home/integrations" : "/home/episodes");
  } catch (e: any) {
    return json({ errors: { body: e.message } }, { status: 400 });
  }
}

export default function Onboarding() {
  const { hasGmail, gmailOAuthUrl } = useTypedLoaderData<
    typeof loader
  >() as any;

  const navigate = useNavigate();
  const fetcher = useFetcher();
  const [step, setStep] = useState<"analysis" | "step2" | "complete">(
    "analysis",
  );
  const [summary, setSummary] = useState("");
  const [sessionId] = useState(() => crypto.randomUUID());
  const [redirectTo, setRedirectTo] = useState<string | null>(null);

  const handleAnalysisComplete = (generatedSummary: string) => {
    setSummary(generatedSummary);
    // Transition to step 2 after a brief delay
    setTimeout(() => {
      setStep("step2");
    }, 200);
  };

  const handleStep2Complete = () => {
    setRedirectTo("/home/integrations");
    fetcher.submit(
      { summary },
      { method: "POST", action: "/onboarding" }
    );
  };

  const handleSkip = () => {
    setRedirectTo("/home/episodes");
    fetcher.submit(
      { summary: "" },
      { method: "POST", action: "/onboarding" }
    );
  };

  // Handle navigation after successful submission
  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data && redirectTo) {
      navigate(redirectTo);
      setRedirectTo(null);
    }
  }, [fetcher.state, fetcher.data, redirectTo, navigate]);

  return (
    <div className="flex h-[100vh] w-[100vw] flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-6 md:px-10">
        <div className="flex items-center gap-2 py-4">
          <div className="flex size-8 items-center justify-center rounded-md">
            <Logo size={60} />
          </div>
          <span className="font-medium">C.O.R.E.</span>
        </div>

        <div className="flex items-center">
          <Button variant="secondary" onClick={handleSkip}> skip </Button>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex flex-1 items-center justify-center overflow-y-auto">
        {!hasGmail ? (
          <div className="flex max-w-lg flex-col gap-6 p-6">
            <div className="space-y-3">
              <h2 className="text-xl font-semibold">i'm core.</h2>
              <div className="text-muted-foreground space-y-2 text-base">
                <p>
                  connect gmail and i'll learn about you - who you work with,
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
                disabled={fetcher.state !== "idle"}
              >
                Skip
              </Button>
              {gmailOAuthUrl && (
                <Button
                  size="lg"
                  variant="secondary"
                  onClick={() => {
                    if (gmailOAuthUrl.redirectURL) {
                      window.location.href = gmailOAuthUrl.redirectURL;
                    }
                  }}
                >
                  Connect Gmail
                </Button>
              )}
            </div>
          </div>
        ) : (
          <>
            {step === "analysis" && (
              <OnboardingAgentLoader
                sessionId={sessionId}
                onComplete={handleAnalysisComplete}
                className="w-full"
              />
            )}

            {step === "step2" && (

              <OnboardingStep2
                summary={summary}
                onComplete={handleStep2Complete}
                isCompleting={fetcher.state !== "idle"}
              />

            )}
          </>
        )}
      </div>
    </div>
  );
}
