import type {
  Triple,
  EntityNode,
  EpisodicNode,
  StatementNode,
} from "@core/types";
import crypto from "crypto";

export interface OnboardingQuestion {
  id: string;
  title: string;
  description?: string;
  type: "single-select" | "multi-select" | "text";
  options?: OnboardingOption[];
  placeholder?: string;
  required?: boolean;
}

export interface OnboardingOption {
  id: string;
  label: string;
  value: string;
}

export interface OnboardingAnswer {
  questionId: string;
  value: string | string[];
}

// Onboarding questions in order
export const ONBOARDING_QUESTIONS: OnboardingQuestion[] = [
  {
    id: "role",
    title: "What best describes you?",
    description: 'Role / identity → anchors the "user" node',
    type: "single-select",
    options: [
      { id: "developer", label: "Developer", value: "Developer" },
      { id: "designer", label: "Designer", value: "Designer" },
      {
        id: "product-manager",
        label: "Product Manager",
        value: "Product Manager",
      },
      {
        id: "engineering-manager",
        label: "Engineering Manager",
        value: "Engineering Manager",
      },
      {
        id: "founder",
        label: "Founder / Executive",
        value: "Founder / Executive",
      },
      { id: "other", label: "Other", value: "Other" },
    ],
    required: true,
  },
  {
    id: "goal",
    title: "What's your primary goal with CORE?",
    description: 'Motivation → drives the "objective" branch of graph',
    type: "single-select",
    options: [
      {
        id: "personal-memory",
        label: "Build a personal memory system",
        value: "Build a personal memory system",
      },
      {
        id: "team-knowledge",
        label: "Manage team/project knowledge",
        value: "Manage team/project knowledge",
      },
      {
        id: "automate-workflows",
        label: "Automate workflows across tools",
        value: "Automate workflows across tools",
      },
      {
        id: "ai-assistant",
        label: "Power an AI assistant / agent with context",
        value: "Power an AI assistant / agent with context",
      },
      {
        id: "explore-graphs",
        label: "Explore / learn about reified graphs",
        value: "Explore / learn about reified graphs",
      },
    ],
    required: true,
  },
  {
    id: "tools",
    title: "Which tools or data sources do you care about most?",
    description: "Context → lets you connect integration nodes live",
    type: "multi-select",
    options: [
      { id: "github", label: "GitHub", value: "GitHub" },
      { id: "slack", label: "Slack", value: "Slack" },
      { id: "notion", label: "Notion", value: "Notion" },
      { id: "obsidian", label: "Obsidian", value: "Obsidian" },
      { id: "gmail", label: "Gmail", value: "Gmail" },
      { id: "linear", label: "Linear", value: "Linear" },
      {
        id: "figma",
        label: "Figma",
        value: "Figma",
      },
    ],
    required: true,
  },
  {
    id: "use-case",
    title: "What type of use case resonates most?",
    description: 'Application → shapes the "space" or "cluster" nodes',
    type: "single-select",
    options: [
      {
        id: "developer-productivity",
        label: "Developer productivity (code, issues, PRs)",
        value: "Developer productivity",
      },
      {
        id: "knowledge-management",
        label: "Knowledge management (docs, notes, research)",
        value: "Knowledge management",
      },
      {
        id: "team-collaboration",
        label: "Team collaboration (updates, reporting)",
        value: "Team collaboration",
      },
      {
        id: "ai-assistant",
        label: "AI assistant (personal, work, or vertical agent)",
        value: "AI assistant",
      },
      {
        id: "analytics",
        label: "Analytics / insights from activity",
        value: "Analytics / insights from activity",
      },
    ],
    required: true,
  },
];

// Helper function to create entity nodes
async function createEntity(
  name: string,
  type: string,
  userId: string,
  space?: string,
): Promise<EntityNode> {
  const nameEmbedding = [] as any;
  const typeEmbedding = [] as any;

  return {
    uuid: crypto.randomUUID(),
    name,
    type,
    attributes: {},
    nameEmbedding,
    typeEmbedding,
    createdAt: new Date(),
    userId,
    space,
  };
}

// Helper function to create episodic node
async function createEpisode(
  content: string,
  userId: string,
  space?: string,
): Promise<EpisodicNode> {
  const contentEmbedding = [] as any;

  return {
    uuid: crypto.randomUUID(),
    content,
    originalContent: content,
    contentEmbedding,
    metadata: { source: "onboarding" },
    source: "onboarding",
    createdAt: new Date(),
    validAt: new Date(),
    labels: ["onboarding"],
    userId,
    space,
  };
}

// Helper function to create statement node
async function createStatement(
  fact: string,
  userId: string,
  space?: string,
): Promise<StatementNode> {
  const factEmbedding = [] as any;

  return {
    uuid: crypto.randomUUID(),
    fact,
    factEmbedding,
    createdAt: new Date(),
    validAt: new Date(),
    invalidAt: null,
    attributes: {},
    userId,
    space,
  };
}

// Create triplet from onboarding answer
export async function createOnboardingTriplet(
  username: string,
  questionId: string,
  answer: string | string[],
  userId: string,
  space?: string,
): Promise<Triple[]> {
  const triplets: Triple[] = [];

  // Convert array answers to individual triplets
  const answers = Array.isArray(answer) ? answer : [answer];

  for (const singleAnswer of answers) {
    let subject: EntityNode;
    let predicate: EntityNode;
    let object: EntityNode;
    let fact: string;

    switch (questionId) {
      case "role":
        subject = await createEntity(username, "Person", userId, space);
        predicate = await createEntity(
          "has_role",
          "Relationship",
          userId,
          space,
        );
        object = await createEntity(singleAnswer, "Role", userId, space);
        fact = `${username} has role ${singleAnswer}`;
        break;

      case "goal":
        subject = await createEntity(username, "Person", userId, space);
        predicate = await createEntity(
          "has_goal",
          "Relationship",
          userId,
          space,
        );
        object = await createEntity(singleAnswer, "Goal", userId, space);
        fact = `${username} has goal to ${singleAnswer}`;
        break;

      case "tools":
        subject = await createEntity(username, "Person", userId, space);
        predicate = await createEntity(
          "uses_tool",
          "Relationship",
          userId,
          space,
        );
        object = await createEntity(singleAnswer, "Tool", userId, space);
        fact = `${username} uses tool ${singleAnswer}`;
        break;

      case "use-case":
        subject = await createEntity(username, "Person", userId, space);
        predicate = await createEntity(
          "interested_in",
          "Relationship",
          userId,
          space,
        );
        object = await createEntity(singleAnswer, "UseCase", userId, space);
        fact = `${username} is interested in ${singleAnswer}`;
        break;

      default:
        // Generic triplet creation
        subject = await createEntity(username, "Person", userId, space);
        predicate = await createEntity(
          "has_attribute",
          "Relationship",
          userId,
          space,
        );
        object = await createEntity(singleAnswer, "Attribute", userId, space);
        fact = `${username} has attribute ${singleAnswer}`;
    }

    const statement = await createStatement(fact, userId, space);
    const provenance = await createEpisode(
      `Onboarding question: ${questionId} - Answer: ${singleAnswer}`,
      userId,
      space,
    );

    triplets.push({
      statement,
      subject,
      predicate,
      object,
      provenance,
    });
  }

  return triplets;
}

// Create initial identity triplet for preview
export function createInitialIdentityTriplet(displayName: string): any {
  const timestamp = Date.now();
  return {
    sourceNode: {
      uuid: `pronoun-${timestamp}`,
      name: "I",
      labels: ["Pronoun"],
      attributes: { nodeType: "Entity", type: "Pronoun" },
    },
    edge: {
      uuid: `alias-edge-${timestamp}`,
      type: "IS_ALIAS_OF",
      source_node_uuid: `pronoun-${timestamp}`,
      target_node_uuid: `user-${timestamp}`,
    },
    targetNode: {
      uuid: `user-${timestamp}`,
      name: displayName,
      labels: ["Person"],
      attributes: { nodeType: "Entity", type: "Person" },
    },
  };
}

// Process all onboarding answers and create triplets
export async function processOnboardingAnswers(
  username: string,
  answers: OnboardingAnswer[],
  userId: string,
  space?: string,
): Promise<Triple[]> {
  const allTriplets: Triple[] = [];

  for (const answer of answers) {
    const triplets = await createOnboardingTriplet(
      username,
      answer.questionId,
      answer.value,
      userId,
      space,
    );
    allTriplets.push(...triplets);
  }

  return allTriplets;
}
