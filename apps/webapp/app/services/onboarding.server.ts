import type { Triple, EntityNode, EpisodicNode, StatementNode } from "@core/types";
import { getEmbedding } from "~/lib/model.server";
import { createProgressiveEpisode, type OnboardingAnswer } from "~/components/onboarding/onboarding-utils";
import crypto from "crypto";

// Server-side helper functions with embeddings
async function createEntityWithEmbeddings(
  name: string,
  type: string,
  userId: string,
  space?: string,
): Promise<EntityNode> {
  return {
    uuid: crypto.randomUUID(),
    name,
    type,
    attributes: {},
    nameEmbedding: await getEmbedding(name),
    typeEmbedding: await getEmbedding(type),
    createdAt: new Date(),
    userId,
    space,
  };
}

async function createEpisodeWithEmbeddings(
  content: string,
  userId: string,
  space?: string,
): Promise<EpisodicNode> {
  return {
    uuid: crypto.randomUUID(),
    content,
    originalContent: content,
    contentEmbedding: await getEmbedding(content),
    metadata: { source: "onboarding" },
    source: "onboarding",
    createdAt: new Date(),
    validAt: new Date(),
    labels: ["onboarding"],
    userId,
    space,
  };
}

async function createStatementWithEmbeddings(
  fact: string,
  userId: string,
  space?: string,
): Promise<StatementNode> {
  return {
    uuid: crypto.randomUUID(),
    fact,
    factEmbedding: await getEmbedding(fact),
    createdAt: new Date(),
    validAt: new Date(),
    invalidAt: null,
    attributes: {},
    userId,
    space,
  };
}

// Helper function to map question types to statement templates 
function getStatementMapping(questionId: string): {
  predicateType: string;
  objectType: string;
  factTemplate: (subject: string, object: string) => string;
} {
  switch (questionId) {
    case "role":
      return {
        predicateType: "IS_A",
        objectType: "Role", 
        factTemplate: (subject, object) => `${subject} is a ${object.toLowerCase()}`
      };
    case "goal":
      return {
        predicateType: "WANTS_TO",
        objectType: "Goal",
        factTemplate: (subject, object) => `${subject} wants to ${object.toLowerCase()}`
      };
    case "tools":
      return {
        predicateType: "USES",
        objectType: "Tool",
        factTemplate: (subject, object) => `${subject} uses ${object}`
      };
    case "use-case":
      return {
        predicateType: "IS_INTERESTED_IN",
        objectType: "UseCase",
        factTemplate: (subject, object) => `${subject} is interested in ${object.toLowerCase()}`
      };
    default:
      return {
        predicateType: "HAS",
        objectType: "Attribute",
        factTemplate: (subject, object) => `${subject} has ${object}`
      };
  }
}

// Create main onboarding episode with embeddings (server-side only)
export async function createOnboardingEpisodeWithEmbeddings(
  username: string,
  answers: OnboardingAnswer[],
  userId: string,
  space?: string,
): Promise<EpisodicNode> {
  // Generate progressive episode content
  const episodeContent = createProgressiveEpisode(username, answers);
  
  // Create the main onboarding episode with embeddings
  const episode: EpisodicNode = {
    uuid: crypto.randomUUID(),
    content: episodeContent,
    originalContent: episodeContent,
    contentEmbedding: await getEmbedding(episodeContent),
    source: "onboarding",
    metadata: { 
      completedAt: new Date().toISOString(),
      questionCount: answers.length,
      answersData: answers
    },
    createdAt: new Date(),
    validAt: new Date(),
    labels: ["onboarding", "user-profile"],
    userId,
    space,
    sessionId: crypto.randomUUID(),
  };

  return episode;
}

// Process all onboarding answers and create triplets with embeddings (server-side only)
export async function processOnboardingAnswersWithEmbeddings(
  username: string,
  answers: OnboardingAnswer[],
  userId: string,
  space?: string,
): Promise<Triple[]> {
  const allTriplets: Triple[] = [];

  for (const answer of answers) {
    const answerValues = Array.isArray(answer.value) ? answer.value : [answer.value];
    
    for (const singleAnswer of answerValues) {
      // Get the statement mapping for this question type
      const { predicateType, objectType, factTemplate } = getStatementMapping(answer.questionId);
      
      // Create the statement fact (e.g., "Manoj uses GitHub")
      const fact = factTemplate(username, singleAnswer);
      
      // Create entities with embeddings
      const subject = await createEntityWithEmbeddings(username, "Person", userId, space);
      const predicate = await createEntityWithEmbeddings(
        predicateType.toLowerCase().replace('_', ' '),
        "Predicate",
        userId,
        space,
      );
      const object = await createEntityWithEmbeddings(singleAnswer, objectType, userId, space);

      // Create statement with embeddings
      const statement = await createStatementWithEmbeddings(fact, userId, space);
      
      // Create provenance episode with embeddings
      const provenance = await createEpisodeWithEmbeddings(
        `Onboarding question: ${answer.questionId} - Answer: ${singleAnswer}`,
        userId,
        space,
      );

      // Create the reified triple structure
      allTriplets.push({
        statement,
        subject,
        predicate,
        object,
        provenance,
      });
    }
  }

  return allTriplets;
}