import { z } from "zod";
import { useLoaderData } from "@remix-run/react";
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
import { GraphVisualizationClient } from "~/components/graph/graph-client";
import OnboardingQuestionComponent from "~/components/onboarding/onboarding-question";
import {
  ONBOARDING_QUESTIONS,
  processOnboardingAnswers,
  createInitialIdentityStatement,
  createPreviewStatements,
  createProgressiveEpisode,
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
  const { user } = useLoaderData<typeof loader>();
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
      }
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
      const { episode, statements } = createPreviewStatements(userName, newAnswers);
      // Convert episode-statement hierarchy to triplet format for visualization
      const episodeTriplets = convertEpisodeToTriplets(episode, statements);
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

  // Convert episode and statements structure to triplets for visualization
  const convertEpisodeToTriplets = (episode: any, statements: any[]): any[] => {
    const triplets: any[] = [];
    
    // Add the episode node itself
    // Episode will be connected to statements via HAS_PROVENANCE edges
    
    for (const statement of statements) {
      // Episode -> Statement provenance relationship
      triplets.push({
        sourceNode: episode,
        edge: statement.edges.hasProvenance,
        targetNode: statement.statementNode,
      });
      
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
        <div className="absolute top-4 left-4 rounded-lg bg-white/90 p-3 text-sm shadow-lg max-w-xs">
          <div className="mb-1 font-medium">Building Your Memory Graph</div>
          <div className="text-gray-600 mb-2">
            {generatedTriplets.length} connections created
          </div>
          {answers.length > 0 && (
            <div className="border-t pt-2">
              <div className="mb-1 text-xs font-medium text-gray-500">Your Episode:</div>
              <div className="text-xs text-gray-700 italic">
                "{(() => {
                  const userName = user.displayName || user.email;
                  return createProgressiveEpisode(userName, answers);
                })()}"
              </div>
            </div>
          )}
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
