import { z } from "zod";
import { useLoaderData, useNavigate } from "@remix-run/react";
import {
  type ActionFunctionArgs,
  json,
  type LoaderFunctionArgs,
  redirect,
} from "@remix-run/node";
import { requireUser, requireUserId } from "~/services/session.server";
import { updateUser } from "~/models/user.server";
import Logo from "~/components/logo/logo";
import { useState } from "react";
import { OnboardingAgentLoader } from "~/components/onboarding/onboarding-agent-loader";
import { OnboardingChat } from "~/components/onboarding/onboarding-chat";
import { addToQueue } from "~/lib/ingest.server";
import { EpisodeType } from "@core/types";
import { episodesPath } from "~/utils/pathBuilder";
import { Button } from "~/components/ui";

const schema = z.object({
  conversationId: z.string(),
  summary: z.string(),
});

export async function loader({ request }: LoaderFunctionArgs) {
  const user = await requireUser(request);

  // if (user.onboardingComplete) {
  //   return redirect(episodesPath());
  // }

  return json({ user });
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
          source: "Onboarding",
          referenceTime: new Date().toISOString(),
          type: EpisodeType.CONVERSATION,
        },
        userId,
      );
    }

    return redirect("/home/episodes");
  } catch (e: any) {
    return json({ errors: { body: e.message } }, { status: 400 });
  }
}

export default function Onboarding() {
  const navigate = useNavigate();
  const [step, setStep] = useState<"analysis" | "chat" | "complete">(
    "analysis",
  );
  const [summary, setSummary] = useState("");
  const [sessionId] = useState(() => crypto.randomUUID());

  const handleAnalysisComplete = (generatedSummary: string) => {
    setSummary(generatedSummary);
    // Transition to chat after a brief delay
    setTimeout(() => {
      setStep("chat");
    }, 1500);
  };

  const handleChatComplete = async () => {
    // Submit to complete onboarding
    const formData = new FormData();

    formData.append("summary", summary);

    try {
      const response = await fetch("/onboarding", {
        method: "POST",
        body: formData,
      });

      if (response.ok) {
        navigate("/home/episodes");
      }
    } catch (e) {
      console.error("Error completing onboarding:", e);
    }
  };

  return (
    <div className="flex h-[100vh] w-[100vw] flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-6 md:px-10">
        <div className="flex items-center gap-2 py-6 md:py-10">
          <div className="flex size-8 items-center justify-center rounded-md">
            <Logo size={60} />
          </div>
          <span className="font-medium">C.O.R.E.</span>
        </div>

        {step === "chat" && (
          <div>
            <Button variant="secondary" onClick={handleChatComplete}>
              {" "}
              Go to dashboard{" "}
            </Button>
          </div>
        )}
      </div>

      {/* Main Content */}
      <div className="flex flex-1 items-center justify-center overflow-y-auto p-6">
        {step === "analysis" && (
          <OnboardingAgentLoader
            sessionId={sessionId}
            onComplete={handleAnalysisComplete}
            className="w-full"
          />
        )}

        {step === "chat" && (
          <div className="flex h-full w-full flex-col">
            <div className="flex-1 overflow-hidden">
              <OnboardingChat
                conversationId={sessionId}
                onboardingSummary={summary}
                onComplete={handleChatComplete}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
