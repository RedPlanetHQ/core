import { z } from "zod";
import { useLoaderData, useSubmit } from "@remix-run/react";
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
import { GraphVisualizationClient } from "~/components/graph/graph-client";
import OnboardingQuestionComponent from "~/components/onboarding/onboarding-question";
import {
  ONBOARDING_QUESTIONS,
  createInitialIdentityStatement,
  createPreviewStatements,
  createProgressiveEpisode,
  type OnboardingAnswer,
} from "~/components/onboarding/onboarding-utils";

import { parse } from "@conform-to/zod";
import { type RawTriplet } from "~/components/graph/type";
import { addToQueue } from "~/lib/ingest.server";
import { EpisodeType } from "@core/types";
import { inboxPath } from "~/utils/pathBuilder";

const schema = z.object({
  answers: z.string(),
});

export async function loader({ request }: LoaderFunctionArgs) {
  const user = await requireUser(request);

  if (user.onboardingComplete) {
    return redirect(inboxPath());
  }

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
  const parsedAnswers = JSON.parse(answers);
  const user = await requireUser(request);

  try {
    const userName = user.displayName || user.email;
    const episodeText = createProgressiveEpisode(userName, parsedAnswers);

    // Update user's onboarding status
    await updateUser({
      id: userId,
      onboardingComplete: true,
      metadata: {
        answers,
      },
    });

    await addToQueue(
      {
        episodeBody: episodeText,
        source: "Onboarding",
        referenceTime: new Date().toISOString(),
        type: EpisodeType.CONVERSATION,
      },
      userId,
    );

    return redirect("/home/inbox");
  } catch (e: any) {
    return json({ errors: { body: e.message } }, { status: 400 });
  }
}

export default function Onboarding() {
  const { user } = useLoaderData<typeof loader>();
  const submit = useSubmit();

  const [currentQuestion, setCurrentQuestion] = useState(0);
  const [answers, setAnswers] = useState<OnboardingAnswer[]>([]);
  // Initialize with default identity statement converted to triplets
  const getInitialTriplets = () => {
    const displayName = user.displayName || user.email || "User";
    const identityStatement = createInitialIdentityStatement(displayName);

    // Convert identity statement to triplet format for visualization
    return [
      // Statement -> Subject relationship
      {
        sourceNode: identityStatement.statementNode,
        edge: identityStatement.edges.hasSubject,
        targetNode: identityStatement.subjectNode,
      },
      // Statement -> Predicate relationship
      {
        sourceNode: identityStatement.statementNode,
        edge: identityStatement.edges.hasPredicate,
        targetNode: identityStatement.predicateNode,
      },
      // Statement -> Object relationship
      {
        sourceNode: identityStatement.statementNode,
        edge: identityStatement.edges.hasObject,
        targetNode: identityStatement.objectNode,
      },
    ];
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

    // Generate reified statements with episode hierarchy for visualization (client-side preview)
    try {
      const userName = user.displayName || user.email;
      // Create episode and statements using the reified knowledge graph structure
      const { statements } = createPreviewStatements(userName, newAnswers);
      // Convert episode-statement hierarchy to triplet format for visualization
      const episodeTriplets = convertEpisodeToTriplets(statements);
      // Update with identity + episode-based statements
      setGeneratedTriplets([...getInitialTriplets(), ...episodeTriplets]);
    } catch (error) {
      console.error("Error generating preview statements:", error);
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
    const formData = new FormData();
    formData.append("answers", JSON.stringify(answers));

    submit(formData, {
      method: "POST",
    });
  };

  // Convert episode and statements structure to triplets for visualization
  const convertEpisodeToTriplets = (statements: any[]): any[] => {
    const triplets: any[] = [];

    // Add the episode node itself
    // Episode will be connected to statements via HAS_PROVENANCE edges

    for (const statement of statements) {
      // Statement -> Subject relationship
      triplets.push({
        sourceNode: statement.statementNode,
        edge: statement.edges.hasSubject,
        targetNode: statement.subjectNode,
      });

      // Statement -> Predicate relationship
      triplets.push({
        sourceNode: statement.statementNode,
        edge: statement.edges.hasPredicate,
        targetNode: statement.predicateNode,
      });

      // Statement -> Object relationship
      triplets.push({
        sourceNode: statement.statementNode,
        edge: statement.edges.hasObject,
        targetNode: statement.objectNode,
      });
    }

    return triplets;
  };

  // These helper functions are no longer needed as they're moved to onboarding-utils
  // Keeping them for potential backward compatibility

  const currentQuestionData = ONBOARDING_QUESTIONS[currentQuestion];
  const currentAnswer = answers.find(
    (a) => a.questionId === currentQuestionData?.id,
  );

  return (
    <div className="grid h-[100vh] w-[100vw] grid-cols-1 overflow-hidden xl:grid-cols-3">
      <div className="bg-grayAlpha-100 relative col-span-2 hidden xl:block">
        <GraphVisualizationClient
          triplets={generatedTriplets || []}
          clusters={[]}
          selectedClusterId={undefined}
          onClusterSelect={() => {}}
          className="h-full w-full"
          singleClusterView
          forOnboarding
        />
      </div>
      <div className="col-span-1 flex flex-col gap-4 p-6 md:p-10">
        <div className="flex justify-center gap-2 md:justify-start">
          <a href="#" className="flex items-center gap-2 font-medium">
            <div className="flex size-8 items-center justify-center rounded-md">
              <Logo size={60} />
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
    </div>
  );
}
