import { logger } from "~/services/logger.service";
import { prisma } from "~/trigger/utils/prisma";
import { ProviderFactory } from "@core/providers";

export interface UserContext {
  // Identity (from User table)
  name?: string;
  email?: string;

  // Context fields
  role?: string;
  goal?: string;
  tools?: string[];
  source: "onboarding" | "inferred" | "none";
}

// Lazy proxy to avoid initialization order issues
// ProviderFactory is initialized in startup.ts, but this module may be imported before that
const graphProvider = new Proxy({} as ReturnType<typeof ProviderFactory.getGraphProvider>, {
  get(_target, prop) {
    const provider = ProviderFactory.getGraphProvider();
    return provider[prop as keyof typeof provider];
  }
})

/**
 * Get user context with 3-tier fallback:
 * 1. Onboarding data (preferred)
 * 2. Inferred from episodes
 * 3. Generic (no context)
 */
export async function getUserContext(userId: string, workspaceId?: string): Promise<UserContext> {
  // Fetch user identity from database
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { name: true, email: true },
  });

  const identity = {
    name: user?.name || undefined,
    email: user?.email || undefined,
  };

  // Try onboarding statements first
  const onboardingContext = await getOnboardingContext(userId, workspaceId);
  if (
    onboardingContext.role ||
    onboardingContext.goal ||
    onboardingContext.tools?.length
  ) {
    return { ...identity, ...onboardingContext, source: "onboarding" };
  }

  // Fallback: infer from episodes
  const inferredContext = await inferContextFromEpisodes(userId, workspaceId);
  if (inferredContext.role || inferredContext.tools?.length) {
    return { ...identity, ...inferredContext, source: "inferred" };
  }

  // No context available
  return { ...identity, source: "none" };
}

/**
 * Query Neo4j for onboarding statements
 * Looks for IS_A (role), WANTS_TO (goal), USES (tools) predicates
 */
async function getOnboardingContext(userId: string, workspaceId?: string): Promise<{
  role?: string;
  goal?: string;
  tools?: string[];
}> {
  try {
    const result = await graphProvider.getOnboardingEntities(userId, workspaceId ?? "");

    let role: string | undefined;
    let goal: string | undefined;
    const tools: string[] = [];

    for (const record of result) {
      const predicate = record.predicate as string;
      const object = record.object as string;

      if (predicate === "IS_A" && !role) {
        role = object;
      } else if (predicate === "WANTS_TO" && !goal) {
        goal = object;
      } else if (predicate === "USES") {
        tools.push(object);
      }
    }

    logger.info("Retrieved onboarding context", {
      userId,
      hasRole: !!role,
      hasGoal: !!goal,
      toolsCount: tools.length,
    });

    return { role, goal, tools: tools.length > 0 ? tools : undefined };
  } catch (error) {
    logger.warn("Failed to retrieve onboarding context", {
      userId,
      error: error instanceof Error ? error.message : "Unknown error",
    });
    return {};
  }
}

/**
 * Infer user context from episode patterns
 * Uses pattern matching to detect likely role and tools
 */
async function inferContextFromEpisodes(userId: string, workspaceId?: string): Promise<{
  role?: string;
  tools?: string[];
}> {
  try {
    const episodes = await graphProvider.getEpisodesByUser(userId, "createdAt", 100, true, workspaceId);

    // Combine all episode content for pattern analysis
    const allContent = episodes
      .map((episode) => episode.content)
      .join(" ")
      .toLowerCase();

    // Infer role from code/design/product patterns
    let role: string | undefined;

    const rolePatterns = {
      Developer: [
        "function",
        "git",
        "pull request",
        "merge",
        "deploy",
        "typescript",
        "javascript",
        "python",
        "api",
        "endpoint",
        "backend",
        "frontend",
      ],
      Designer: [
        "figma",
        "design",
        "ui",
        "ux",
        "prototype",
        "mockup",
        "visual",
        "aesthetic",
        "color",
        "layout",
      ],
      "Product Manager": [
        "roadmap",
        "strategy",
        "stakeholder",
        "prioritize",
        "requirements",
        "feature request",
        "user story",
        "sprint",
      ],
      "Engineering Manager": [
        "1-on-1",
        "team",
        "performance review",
        "hiring",
        "onboarding",
        "career",
        "mentor",
        "lead",
      ],
    };

    let maxScore = 0;
    for (const [roleName, patterns] of Object.entries(rolePatterns)) {
      const score = patterns.filter((pattern) =>
        allContent.includes(pattern),
      ).length;
      if (score > maxScore && score >= 3) {
        // Require at least 3 matching patterns
        maxScore = score;
        role = roleName;
      }
    }

    // Infer tools from mentions
    const toolPatterns = {
      Claude: ["claude", "anthropic"],
      "Claude Code": ["claude code"],
      Cursor: ["cursor"],
      Windsurf: ["windsurf"],
      GitHub: ["github", "gh", "pull request", "pr"],
      Slack: ["slack"],
      Notion: ["notion"],
      Obsidian: ["obsidian"],
      Linear: ["linear"],
      Figma: ["figma"],
    };

    const tools: string[] = [];
    for (const [toolName, patterns] of Object.entries(toolPatterns)) {
      if (patterns.some((pattern) => allContent.includes(pattern))) {
        tools.push(toolName);
      }
    }

    logger.info("Inferred context from episodes", {
      userId,
      role,
      toolsCount: tools.length,
      episodesAnalyzed: episodes.length,
    });

    return {
      role,
      tools: tools.length > 0 ? tools : undefined,
    };
  } catch (error) {
    logger.warn("Failed to infer context from episodes", {
      userId,
      error: error instanceof Error ? error.message : "Unknown error",
    });
    return {};
  }
}
