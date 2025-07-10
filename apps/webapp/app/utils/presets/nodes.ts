export enum Apps {
  LINEAR = "LINEAR",
  SLACK = "SLACK",
  SOL = "SOL",
  GITHUB = "GITHUB",
}

export const AppNames = {
  [Apps.LINEAR]: "Linear",
  [Apps.SLACK]: "Slack",
  [Apps.SOL]: "Sol",
  [Apps.GITHUB]: "GitHub",
} as const;

// Define attribute structure
export interface NodeAttribute {
  name: string;
  description: string;
  type?: "string" | "number" | "boolean" | "date" | "array";
  required?: boolean;
}

// General node types that are common across all apps
export const GENERAL_NODE_TYPES = {
  PERSON: {
    name: "Person",
    description: "Represents an individual, like a team member or contact",
    attributes: [
      {
        name: "email",
        description: "The email address of the person",
        type: "string",
      },
      {
        name: "role",
        description: "The role or position of the person",
        type: "string",
      },
    ],
  },
  APP: {
    name: "App",
    description: "A software application or service that's integrated",
    attributes: [],
  },
  PLACE: {
    name: "Place",
    description: "A physical location like an office, meeting room, or city",
    attributes: [
      {
        name: "address",
        description: "The address of the location",
        type: "string",
      },
      {
        name: "coordinates",
        description: "Geographic coordinates of the location",
        type: "string",
      },
    ],
  },
  ORGANIZATION: {
    name: "Organization",
    description: "A company, team, or any formal group of people",
    attributes: [
      {
        name: "industry",
        description: "The industry the organization operates in",
        type: "string",
      },
      {
        name: "size",
        description: "The size of the organization",
        type: "string",
      },
    ],
  },
  EVENT: {
    name: "Event",
    description: "A meeting, deadline, or any time-based occurrence",
    attributes: [
      {
        name: "startTime",
        description: "The start date and time of the event",
        type: "date",
        required: true,
      },
      {
        name: "endTime",
        description: "The end date and time of the event",
        type: "date",
      },
      {
        name: "location",
        description: "The location of the event",
        type: "string",
      },
    ],
  },
  ALIAS: {
    name: "Alias",
    description: "An alternative name or identifier for nouns and pronouns",
    attributes: [
      {
        name: "originalName",
        description: "The original name this is an alias for",
        type: "string",
      },
      {
        name: "context",
        description: "The context in which this alias is used",
        type: "string",
      },
    ],
  },
  FILE: {
    name: "File",
    description: "A document, image or other file shared in an app",
    attributes: [
      {
        name: "fileId",
        description: "Unique identifier for the file",
        type: "string",
        required: true,
      },
      {
        name: "source",
        description: "The source of the file",
        type: "string",
        required: true,
      },
    ],
  },
} as const;

// App-specific node types
export const APP_NODE_TYPES = {
  [Apps.SOL]: {
    TASK: {
      name: "Sol Task",
      description:
        "An independent unit of work in Sol, such as a task, bug report, or feature request. Tasks can be associated with lists or linked as subtasks to other tasks.",
      attributes: [
        {
          name: "taskId",
          description: "Unique identifier for the task",
          type: "string",
          required: true,
        },
      ],
    },
    LIST: {
      name: "Sol List",
      description:
        "A flexible container in Sol for organizing content such as tasks, text, or references. Lists are used for task tracking, information collections, or reference materials.",
      attributes: [
        {
          name: "listId",
          description: "Unique identifier for the list",
          type: "string",
          required: true,
        },
      ],
    },
    PREFERENCE: {
      name: "Sol Preference",
      description:
        "A user-stated intent, setting, or configuration in Sol, such as preferred formats, notification settings, timezones, or other customizations. Preferences reflect how a user wants the system to behave.",
      attributes: [
        {
          name: "key",
          description: "The preference key or name",
          type: "string",
          required: true,
        },
        {
          name: "value",
          description: "The preference value",
          type: "string",
          required: true,
        },
      ],
    },
    AUTOMATION: {
      name: "Sol Automation",
      description:
        "A workflow or rule in Sol that automatically performs actions based on specific conditions or triggers, such as recurring tasks, reminders, or integrations with other systems.",
      attributes: [
        {
          name: "automationId",
          description: "Unique identifier for the automation",
          type: "string",
          required: true,
        },
      ],
    },
  },
  [Apps.LINEAR]: {
    ISSUE: {
      name: "Linear Issue",
      description: "A task, bug report, or feature request tracked in Linear",
      attributes: [
        {
          name: "issueId",
          description: "Unique identifier for the issue",
          type: "string",
          required: true,
        },
      ],
    },
    PROJECT: {
      name: "Linear Project",
      description: "A collection of related issues and work items in Linear",
      attributes: [
        {
          name: "projectId",
          description: "Unique identifier for the project",
          type: "string",
          required: true,
        },
      ],
    },
    CYCLE: {
      name: "Linear Cycle",
      description: "A time-boxed iteration of work in Linear",
      attributes: [
        {
          name: "cycleId",
          description: "Unique identifier for the cycle",
          type: "string",
          required: true,
        },
      ],
    },
    TEAM: {
      name: "Linear Team",
      description: "A group of people working together in Linear",
      attributes: [
        {
          name: "teamId",
          description: "Unique identifier for the team",
          type: "string",
          required: true,
        },
      ],
    },
    LABEL: {
      name: "Linear Label",
      description: "A tag used to categorize and organize issues in Linear",
      attributes: [
        {
          name: "labelId",
          description: "Unique identifier for the label",
          type: "string",
          required: true,
        },
      ],
    },
  },
  [Apps.SLACK]: {
    CHANNEL: {
      name: "Slack Channel",
      description: "A dedicated space for team communication in Slack",
      attributes: [
        {
          name: "channelId",
          description: "Unique identifier for the channel",
          type: "string",
          required: true,
        },

        {
          name: "isPrivate",
          description: "Whether the channel is private",
          type: "boolean",
        },
      ],
    },
    THREAD: {
      name: "Slack Thread",
      description: "A focused conversation branch within a Slack channel",
      attributes: [
        {
          name: "threadId",
          description: "Unique identifier for the thread",
          type: "string",
          required: true,
        },
        {
          name: "parentMessageId",
          description: "ID of the parent message",
          type: "string",
          required: true,
        },
      ],
    },
    MESSAGE: {
      name: "Slack Message",
      description: "A single communication sent in a Slack channel or thread",
      attributes: [
        {
          name: "messageId",
          description: "Unique identifier for the message",
          type: "string",
          required: true,
        },
      ],
    },
    REACTION: {
      name: "Slack Reaction",
      description: "An emoji response to a message in Slack",
      attributes: [
        {
          name: "emoji",
          description: "The emoji used in the reaction",
          type: "string",
          required: true,
        },
      ],
    },
  },
  [Apps.GITHUB]: {
    REPOSITORY: {
      name: "GitHub Repository",
      description: "A code repository hosted on GitHub",
      attributes: [
        {
          name: "repoId",
          description: "Unique identifier for the repository",
          type: "string",
          required: true,
        },
        {
          name: "name",
          description: "The name of the repository",
          type: "string",
          required: true,
        },
        {
          name: "owner",
          description: "Owner (user or organization) of the repository",
          type: "string",
          required: true,
        },
      ],
    },
    ISSUE: {
      name: "GitHub Issue",
      description: "An issue created to track bugs, tasks, or feature requests",
      attributes: [
        {
          name: "issueId",
          description: "Unique identifier for the issue",
          type: "string",
          required: true,
        },
      ],
    },
    PULL_REQUEST: {
      name: "GitHub Pull Request",
      description: "A pull request to propose changes to a repository",
      attributes: [
        {
          name: "PR number",
          description: "Unique number for the pull request",
          type: "string",
          required: true,
        },
      ],
    },
    COMMIT: {
      name: "GitHub Commit",
      description: "A commit representing a set of changes in a repository",
      attributes: [
        {
          name: "commitSha",
          description: "SHA hash of the commit",
          type: "string",
          required: true,
        },
      ],
    },
    BRANCH: {
      name: "GitHub Branch",
      description: "A branch in a GitHub repository",
      attributes: [
        {
          name: "branchName",
          description: "Name of the branch",
          type: "string",
          required: true,
        },
      ],
    },
  },
} as const;

/**
 * Returns both general node types and app-specific node types for given apps
 * @param apps Array of app names to get node types for
 * @returns Object containing general and app-specific node types
 */
export function getNodeTypes(apps: Array<keyof typeof APP_NODE_TYPES>) {
  const appSpecificTypes = apps.reduce((acc, appName) => {
    return {
      ...acc,
      [appName]: APP_NODE_TYPES[appName],
    };
  }, {});

  return {
    general: GENERAL_NODE_TYPES,
    appSpecific: appSpecificTypes,
  };
}

export function getNodeTypesString(apps: Array<keyof typeof APP_NODE_TYPES>) {
  let nodeTypesString = "";
  const generalTypes = Object.entries(GENERAL_NODE_TYPES)
    .map(([key, value]) => {
      return `- ${key}: "${value.description}"`;
    })
    .join("\n");
  nodeTypesString += `General Node Types:\n${generalTypes}\n\n`;

  const appSpecificTypes = apps.reduce((acc, appName) => {
    return {
      ...acc,
      [appName]: APP_NODE_TYPES[appName],
    };
  }, {});

  const appSpecificTypesString = Object.entries(appSpecificTypes)
    .map(([appName, types]) => {
      return `For ${appName}:\n${Object.entries(types as any)
        .map(([key, value]: any) => {
          return `- ${key}: "${value.description}"`;
        })
        .join("\n")}\n\n`;
    })
    .join("\n\n");

  nodeTypesString += `App-specific Node Types:\n${appSpecificTypesString}`;
  return nodeTypesString;
}

export function getNodeAttributesString(
  apps: Array<keyof typeof APP_NODE_TYPES>,
) {}

/**
 * Check if a type is a preset type (from GENERAL_NODE_TYPES or APP_NODE_TYPES)
 */
export function isPresetType(
  type: string,
  apps: Array<keyof typeof APP_NODE_TYPES> = [],
): boolean {
  // Check general types
  const generalTypes = Object.keys(GENERAL_NODE_TYPES).map(
    (key) => GENERAL_NODE_TYPES[key as keyof typeof GENERAL_NODE_TYPES].name,
  );

  if (generalTypes.includes(type as any)) {
    return true;
  }

  // Check app-specific types
  for (const app of apps) {
    const appTypes = Object.keys(APP_NODE_TYPES[app] || {}).map(
      (key) =>
        APP_NODE_TYPES[app][key as keyof (typeof APP_NODE_TYPES)[typeof app]]
          .name,
    );
    if (appTypes.includes(type as any)) {
      return true;
    }
  }

  return false;
}

/**
 * Get all preset types for given apps
 */
export function getAllPresetTypes(
  apps: Array<keyof typeof APP_NODE_TYPES> = [],
): string[] {
  const generalTypes = Object.keys(GENERAL_NODE_TYPES).map(
    (key) => GENERAL_NODE_TYPES[key as keyof typeof GENERAL_NODE_TYPES].name,
  );

  const appTypes = apps.flatMap((app) =>
    Object.keys(APP_NODE_TYPES[app] || {}).map(
      (key) =>
        APP_NODE_TYPES[app][key as keyof (typeof APP_NODE_TYPES)[typeof app]]
          .name,
    ),
  );

  return [...generalTypes, ...appTypes];
}
