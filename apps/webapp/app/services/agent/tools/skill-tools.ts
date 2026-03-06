/**
 * Skill Tools for Core Agent
 *
 * Provides get_skill tool for Sol to load skill instructions directly.
 */

import { tool, type Tool } from "ai";
import { z } from "zod";
import { prisma } from "~/db.server";
import { logger } from "~/services/logger.service";

/**
 * Get the get_skill tool for Sol
 */
export function getSkillTool(workspaceId: string): Tool {
  return tool({
    description:
      "Load a user-defined skill's full instructions by ID. Use this when a skill is attached to a reminder or when the user asks to run a skill. Returns the skill's step-by-step instructions.",
    inputSchema: z.object({
      skill_id: z.string().describe("The skill ID to load"),
    }),
    execute: async ({ skill_id }) => {
      try {
        logger.info(`Core agent: loading skill ${skill_id}`);
        const skill = await prisma.document.findFirst({
          where: { id: skill_id, workspaceId, type: "skill", deleted: null },
          select: { id: true, title: true, content: true },
        });
        if (!skill) return "Skill not found";
        return `## Skill: ${skill.title}\n\n${skill.content}`;
      } catch (error) {
        logger.warn("Core agent: failed to load skill", { error });
        return "Failed to load skill";
      }
    },
  });
}
