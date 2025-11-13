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
        id: "explore-core",
        label: "Explore core",
        value: "Explore core",
      },
    ],
    required: true,
  },
  {
    id: "tools",
    title: "Which tools do you care about most?",
    description: "Context → lets you connect integration nodes live",
    type: "multi-select",
    options: [
      { id: "claude", label: "Claude", value: "Claude" },
      { id: "claude-code", label: "Claude Code", value: "Claude Code" },
      { id: "cursor", label: "Cursor", value: "Cursor" },
      { id: "windsurf", label: "Windsurf", value: "Windsurf" },
      { id: "zed", label: "Zed", value: "Zed" },
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
];

// Helper function to create entity nodes (client-side, no embeddings)
function createEntity(
  name: string,
  type: string,
  userId: string,
  space?: string,
): EntityNode {
  return {
    uuid: crypto.randomUUID(),
    name,
    type,
    attributes: {},
    nameEmbedding: [], // Empty placeholder for client-side preview
    createdAt: new Date(),
    userId,
  };
}

// Helper function to create episodic node (client-side, no embeddings)
function createEpisode(
  content: string,
  userId: string,
  space?: string,
): EpisodicNode {
  return {
    uuid: crypto.randomUUID(),
    content,
    originalContent: content,
    contentEmbedding: [], // Empty placeholder for client-side preview
    metadata: { source: "onboarding" },
    source: "onboarding",
    createdAt: new Date(),
    validAt: new Date(),
    labelIds: [], // Labels will be assigned server-side during actual ingestion
    userId,
  };
}

// Helper function to create statement node (client-side, no embeddings)
function createStatement(
  fact: string,
  userId: string,
  space?: string,
): StatementNode {
  return {
    uuid: crypto.randomUUID(),
    fact,
    factEmbedding: [], // Empty placeholder for client-side preview
    createdAt: new Date(),
    validAt: new Date(),
    invalidAt: null,
    attributes: {},
    userId
  };
}

// Create triplet from onboarding answer using reified knowledge graph structure (client-side, no embeddings)
export function createOnboardingTriplet(
  username: string,
  questionId: string,
  answer: string | string[],
  userId: string,
  space?: string,
): Triple[] {
  const triplets: Triple[] = [];

  // Convert array answers to individual triplets
  const answers = Array.isArray(answer) ? answer : [answer];

  for (const singleAnswer of answers) {
    // Get the statement mapping for this question type
    const { predicateType, objectType, factTemplate } =
      getStatementMapping(questionId);

    // Create the statement fact (e.g., "Manoj uses GitHub")
    const fact = factTemplate(username, singleAnswer);

    // Create entities following CORE's reified structure (client-side preview only)
    const subject = createEntity(username, "Person", userId, space);
    const predicate = createEntity(
      predicateType.toLowerCase().replace("_", " "), // "uses tool" instead of "USES_TOOL"
      "Predicate", // Use "Predicate" type instead of "Relationship"
      userId,
      space,
    );
    const object = createEntity(singleAnswer, objectType, userId, space);

    // Create statement node as first-class object (client-side preview only)
    const statement = createStatement(fact, userId, space);

    // Create provenance episode (client-side preview only)
    const provenance = createEpisode(
      `Onboarding question: ${questionId} - Answer: ${singleAnswer}`,
      userId,
      space,
    );

    // Create the reified triple structure (no embeddings for client preview)
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

// Create initial identity statement for preview using reified knowledge graph structure
export function createInitialIdentityStatement(displayName: string): any {
  const timestamp = Date.now();
  const now = new Date().toISOString();

  // Create the identity statement: "I'm [DisplayName]" using reified structure
  const fact = `I'm ${displayName}`;

  return {
    // Statement node (center)
    statementNode: {
      uuid: `identity-statement-${timestamp}`,
      name: fact,
      labels: ["Statement"],
      attributes: {
        nodeType: "Statement",
        type: "Statement",
        fact: fact,
        source: "onboarding",
        validAt: now,
      },
      createdAt: now,
    },
    // Subject entity ("I")
    subjectNode: {
      uuid: `pronoun-${timestamp}`,
      name: "I",
      labels: ["Entity"],
      attributes: {
        nodeType: "Entity",
        type: "Pronoun",
        source: "onboarding",
      },
      createdAt: now,
    },
    // Predicate entity ("am")
    predicateNode: {
      uuid: `predicate-identity-${timestamp}`,
      name: "am",
      labels: ["Entity"],
      attributes: {
        nodeType: "Entity",
        type: "Predicate",
        source: "onboarding",
      },
      createdAt: now,
    },
    // Object entity (DisplayName)
    objectNode: {
      uuid: `user-${timestamp}`,
      name: displayName,
      labels: ["Entity"],
      attributes: {
        nodeType: "Entity",
        type: "Person",
        source: "onboarding",
      },
      createdAt: now,
    },
    // Edges connecting statement to subject, predicate, object
    edges: {
      hasSubject: {
        uuid: `identity-has-subject-${timestamp}`,
        type: "HAS_SUBJECT",
        source_node_uuid: `identity-statement-${timestamp}`,
        target_node_uuid: `pronoun-${timestamp}`,
        createdAt: now,
      },
      hasPredicate: {
        uuid: `identity-has-predicate-${timestamp}`,
        type: "HAS_PREDICATE",
        source_node_uuid: `identity-statement-${timestamp}`,
        target_node_uuid: `predicate-identity-${timestamp}`,
        createdAt: now,
      },
      hasObject: {
        uuid: `identity-has-object-${timestamp}`,
        type: "HAS_OBJECT",
        source_node_uuid: `identity-statement-${timestamp}`,
        target_node_uuid: `user-${timestamp}`,
        createdAt: now,
      },
    },
  };
}

// Create progressive episode content as user answers questions
export function createProgressiveEpisode(
  username: string,
  answers: OnboardingAnswer[],
): string {
  // Start with identity
  let episodeContent = `I'm ${username}.`;

  // Build episode progressively based on answers
  for (const answer of answers) {
    const values = Array.isArray(answer.value) ? answer.value : [answer.value];

    switch (answer.questionId) {
      case "role":
        episodeContent += ` I'm a ${values[0]}.`;
        break;

      case "goal":
        episodeContent += ` My primary goal with CORE is to ${values[0].toLowerCase()}.`;
        break;

      case "tools":
        if (values.length === 1) {
          episodeContent += ` I use ${values[0]}.`;
        } else if (values.length === 2) {
          episodeContent += ` I use ${values[0]} and ${values[1]}.`;
        } else {
          // Create a copy to avoid mutating the original array
          const toolsCopy = [...values];
          const lastTool = toolsCopy.pop();
          episodeContent += ` I use ${toolsCopy.join(", ")}, and ${lastTool}.`;
        }
        break;
    }
  }

  return episodeContent;
}

// Create preview statements for real-time visualization (reified structure)
// Including episode hierarchy: Episode → Statements → Entities
export function createPreviewStatements(
  username: string,
  answers: OnboardingAnswer[],
): { episode: any; statements: any[] } {
  const allStatements: any[] = [];
  const now = new Date().toISOString();
  const baseTimestamp = Date.now();

  // Create the cumulative episode content
  const episodeContent = createProgressiveEpisode(username, answers);

  // Create episode node that contains all statements
  const episode = {
    uuid: `onboarding-episode-${baseTimestamp}`,
    name: username,
    content: episodeContent,
    labels: ["Episode"],
    attributes: {
      nodeType: "Episode",
      type: "Episode",
      source: "onboarding",
      content: episodeContent,
      validAt: now,
    },
    createdAt: now,
  };

  // Create user entity that will be the subject of all statements
  const userEntityId = `user-${baseTimestamp}`;

  for (let i = 0; i < answers.length; i++) {
    const answer = answers[i];
    const values = Array.isArray(answer.value) ? answer.value : [answer.value];

    for (let j = 0; j < values.length; j++) {
      const value = values[j];
      const uniqueId = `${baseTimestamp}-${i}-${j}`;

      // Get the relationship mapping for this question
      const { predicateType, objectType, factTemplate } = getStatementMapping(
        answer.questionId,
      );

      // Create the statement fact (e.g., "Manoj uses GitHub")
      const fact = factTemplate(username, value);

      // Create statement visualization as a reified structure
      const statement = {
        // Statement node (center)
        statementNode: {
          uuid: `statement-${uniqueId}`,
          name: fact,
          labels: ["Statement"],
          attributes: {
            nodeType: "Statement",
            type: "Statement",
            fact: fact,
            source: "onboarding",
            validAt: now,
          },
          createdAt: now,
        },
        // Subject entity (user)
        subjectNode: {
          uuid: userEntityId,
          name: username,
          labels: ["Entity"],
          attributes: {
            nodeType: "Entity",
            type: "Person",
            source: "onboarding",
          },
          createdAt: now,
        },
        // Predicate entity (relationship type)
        predicateNode: {
          uuid: `predicate-${predicateType}-${uniqueId}`,
          name: predicateType.toLowerCase().replace("_", " "),
          labels: ["Entity"],
          attributes: {
            nodeType: "Entity",
            type: "Predicate",
            source: "onboarding",
          },
          createdAt: now,
        },
        // Object entity (the thing being related to)
        objectNode: {
          uuid: `object-${uniqueId}`,
          name: value,
          labels: ["Entity"],
          attributes: {
            nodeType: "Entity",
            type: objectType,
            source: "onboarding",
          },
          createdAt: now,
        },
        // Edges connecting statement to subject, predicate, object
        edges: {
          hasSubject: {
            uuid: `has-subject-${uniqueId}`,
            type: "HAS_SUBJECT",
            source_node_uuid: `statement-${uniqueId}`,
            target_node_uuid: userEntityId,
            createdAt: now,
          },
          hasPredicate: {
            uuid: `has-predicate-${uniqueId}`,
            type: "HAS_PREDICATE",
            source_node_uuid: `statement-${uniqueId}`,
            target_node_uuid: `predicate-${predicateType}-${uniqueId}`,
            createdAt: now,
          },
          hasObject: {
            uuid: `has-object-${uniqueId}`,
            type: "HAS_OBJECT",
            source_node_uuid: `statement-${uniqueId}`,
            target_node_uuid: `object-${uniqueId}`,
            createdAt: now,
          },
          // Provenance connection: Episode → Statement
          hasProvenance: {
            uuid: `provenance-${uniqueId}`,
            type: "HAS_PROVENANCE",
            source_node_uuid: `statement-${uniqueId}`,
            target_node_uuid: episode.uuid,
            createdAt: now,
          },
        },
      };

      allStatements.push(statement);
    }
  }

  return { episode, statements: allStatements };
}

// Helper function to map question types to statement templates with natural English phrasing
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
        factTemplate: (subject, object) =>
          `${subject} is a ${object.toLowerCase()}`,
      };
    case "goal":
      return {
        predicateType: "WANTS_TO",
        objectType: "Goal",
        factTemplate: (subject, object) =>
          `${subject} wants to ${object.toLowerCase()}`,
      };
    case "tools":
      return {
        predicateType: "USES",
        objectType: "Tool",
        factTemplate: (subject, object) => `${subject} uses ${object}`,
      };
    default:
      return {
        predicateType: "HAS",
        objectType: "Attribute",
        factTemplate: (subject, object) => `${subject} has ${object}`,
      };
  }
}

// Create main onboarding episode (client-side preview, no embeddings)
export function createOnboardingEpisode(
  username: string,
  answers: OnboardingAnswer[],
  userId: string,
  space?: string,
): EpisodicNode {
  // Generate progressive episode content
  const episodeContent = createProgressiveEpisode(username, answers);

  // Create the main onboarding episode for client preview
  const episode: EpisodicNode = {
    uuid: crypto.randomUUID(),
    content: episodeContent,
    originalContent: episodeContent, // Same as content for onboarding
    contentEmbedding: [], // Empty placeholder for client-side preview
    source: "onboarding",
    metadata: {
      completedAt: new Date().toISOString(),
      questionCount: answers.length,
      answersData: answers, // Store original answers for reference
    },
    createdAt: new Date(),
    validAt: new Date(),
    labelIds: [], // Labels will be assigned server-side during actual ingestion
    userId,
    sessionId: crypto.randomUUID(), // Generate unique session for onboarding
  };

  return episode;
}
