import { z } from "zod";
import { useActionData, useLoaderData } from "@remix-run/react";
import {
  type ActionFunctionArgs,
  json,
  type LoaderFunctionArgs,
  redirect,
} from "@remix-run/node";
import { requireUser, requireUserId } from "~/services/session.server";
import { updateUser } from "~/models/user.server";
import type { Triple } from "@core/types";
import Logo from "~/components/logo/logo";
import { useState, useEffect } from "react";
import { GraphVisualizationClient } from "~/components/graph/graph-client";
import OnboardingQuestionComponent from "~/components/onboarding/onboarding-question";
import {
  ONBOARDING_QUESTIONS,
  processOnboardingAnswers,
  createInitialIdentityTriplet,
  type OnboardingAnswer,
} from "~/components/onboarding/onboarding-utils";
import { saveTriple } from "~/services/graphModels/statement";
import { parse } from "@conform-to/zod";
import { type RawTriplet } from "~/components/graph/type";

const schema = z.object({
  answers: z.array(
    z.object({
      questionId: z.string(),
      value: z.union([z.string(), z.array(z.string())]),
    }),
  ),
});

export async function loader({ request }: LoaderFunctionArgs) {
  const user = await requireUser(request);
  return json({ user });
}

export async function action({ request }: ActionFunctionArgs) {
  const userId = await requireUserId(request);
  const formData = await request.formData();
  const submission = parse(formData, { schema });

  if (!submission.value || submission.intent !== "submit") {
    return json(submission);
  }

  const { answers } = submission.value;
  const user = await requireUser(request);

  try {
    // Process onboarding answers and create triplets
    const triplets = await processOnboardingAnswers(
      user.displayName || user.email,
      answers,
      userId,
    );

    // Save all triplets to Neo4j
    const savedTriplets = [];
    for (const triplet of triplets) {
      const statementUuid = await saveTriple(triplet);
      savedTriplets.push({ ...triplet, statementUuid });
    }

    // Update user's onboarding status
    await updateUser({
      id: userId,
      onboardingComplete: true,
    });

    return redirect("/dashboard");
  } catch (e: any) {
    return json({ errors: { body: e.message } }, { status: 400 });
  }
}

export default function Onboarding() {
  const lastSubmission = useActionData<typeof action>();
  const { user } = useLoaderData<typeof loader>();
  const [currentQuestion, setCurrentQuestion] = useState(0);
  const [answers, setAnswers] = useState<OnboardingAnswer[]>([]);
  // Initialize with default identity triplet
  const getInitialTriplets = () => {
    const displayName = user.displayName || user.email || "User";
    return [createInitialIdentityTriplet(displayName)];
  };

  const [generatedTriplets, setGeneratedTriplets] =
    useState<RawTriplet[]>(getInitialTriplets);

  const handleAnswer = async (answer: OnboardingAnswer) => {
    // Update answers array
    const newAnswers = [...answers];
    const existingIndex = newAnswers.findIndex(
      (a) => a.questionId === answer.questionId,
    );

    if (existingIndex >= 0) {
      newAnswers[existingIndex] = answer;
    } else {
      newAnswers.push(answer);
    }

    setAnswers(newAnswers);

    // Generate triplets for visualization (client-side preview)
    try {
      // This would normally be server-side, but for live preview we can simulate
      // In production, you'd call an API endpoint to generate the triplets
      const userName = user.displayName || user.email;
      const mockTriplets = await generateMockTripletsForPreview(
        userName,
        answer,
      );
      setGeneratedTriplets((prev) => [...prev, ...mockTriplets]);
    } catch (error) {
      console.error("Error generating preview triplets:", error);
    }
  };

  const handleNext = () => {
    if (currentQuestion < ONBOARDING_QUESTIONS.length - 1) {
      setCurrentQuestion(currentQuestion + 1);
    } else {
      // Submit all answers
      submitAnswers();
    }
  };

  const handlePrevious = () => {
    if (currentQuestion > 0) {
      setCurrentQuestion(currentQuestion - 1);
    }
  };

  const submitAnswers = async () => {
    const form = new FormData();
    form.append("answers", JSON.stringify(answers));

    const response = await fetch("/onboarding", {
      method: "POST",
      body: form,
    });

    if (response.ok) {
      window.location.href = "/dashboard";
    } else {
      console.error("Failed to submit answers");
    }
  };

  // Helper function to generate mock triplets for preview (client-side)
  const generateMockTripletsForPreview = async (
    userName: string,
    answer: OnboardingAnswer,
  ): Promise<any[]> => {
    // This is a simplified version for client-side preview
    // The actual triplet generation happens server-side
    const values = Array.isArray(answer.value) ? answer.value : [answer.value];
    const displayName = user.displayName || user.name || userName;

    return values.map((value) => ({
      sourceNode: {
        uuid: `user-${Date.now()}`,
        name: displayName,
        labels: ["Person"],
        attributes: { nodeType: "Entity", type: "Person" },
      },
      edge: {
        uuid: `edge-${Date.now()}`,
        type: getPredicateForQuestion(answer.questionId),
        source_node_uuid: `user-${Date.now()}`,
        target_node_uuid: `value-${Date.now()}`,
      },
      targetNode: {
        uuid: `value-${Date.now()}`,
        name: value,
        labels: [getNodeTypeForQuestion(answer.questionId)],
        attributes: {
          nodeType: "Entity",
          type: getNodeTypeForQuestion(answer.questionId),
        },
      },
    }));
  };

  const getPredicateForQuestion = (questionId: string): string => {
    const predicates: Record<string, string> = {
      role: "HAS_ROLE",
      goal: "HAS_GOAL",
      tools: "USES_TOOL",
      "use-case": "INTERESTED_IN",
    };
    return predicates[questionId] || "HAS_ATTRIBUTE";
  };

  const getNodeTypeForQuestion = (questionId: string): string => {
    const types: Record<string, string> = {
      role: "Role",
      goal: "Goal",
      tools: "Tool",
      "use-case": "UseCase",
    };
    return types[questionId] || "Attribute";
  };

  const currentQuestionData = ONBOARDING_QUESTIONS[currentQuestion];
  const currentAnswer = answers.find(
    (a) => a.questionId === currentQuestionData?.id,
  );

  return (
    <div className="grid h-[100vh] w-[100vw] grid-cols-1 overflow-hidden xl:grid-cols-2">
      <div className="flex flex-col gap-4 p-6 md:p-10">
        <div className="flex justify-center gap-2 md:justify-start">
          <a href="#" className="flex items-center gap-2 font-medium">
            <div className="flex size-8 items-center justify-center rounded-md">
              <Logo width={60} height={60} />
            </div>
            C.O.R.E.
          </a>
        </div>
        <div className="flex flex-1 items-center justify-center">
          {currentQuestionData && (
            <OnboardingQuestionComponent
              question={currentQuestionData}
              answer={currentAnswer?.value}
              onAnswer={handleAnswer}
              onNext={handleNext}
              onPrevious={handlePrevious}
              isFirst={currentQuestion === 0}
              isLast={currentQuestion === ONBOARDING_QUESTIONS.length - 1}
              currentStep={currentQuestion + 1}
              totalSteps={ONBOARDING_QUESTIONS.length}
            />
          )}
        </div>
      </div>

      <div className="bg-grayAlpha-100 relative hidden xl:block">
        <div className="absolute top-4 left-4 rounded-lg bg-white/90 p-3 text-sm shadow-lg">
          <div className="mb-1 font-medium">Building Your Memory Graph</div>
          <div className="text-gray-600">
            {generatedTriplets.length} connections created
          </div>
        </div>
        <GraphVisualizationClient
          triplets={generatedTriplets || []}
          clusters={[]}
          selectedClusterId={undefined}
          onClusterSelect={() => {}}
          className="h-full w-full"
          singleClusterView
        />
      </div>
    </div>
  );
}
