/**
 * Skill Tools for Core Agent
 *
 * Provides skill management tools: get_skill, create_skill, update_skill.
 */

import { tool, type Tool } from "ai";
import { z } from "zod";
import { prisma } from "~/db.server";
import { logger } from "~/services/logger.service";
import { createSkill, updateSkill } from "~/services/skills.server";

/**
 * Get the get_skill tool for the agent
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

/**
 * Create a new skill
 */
export function createSkillTool(workspaceId: string, userId: string): Tool {
  return tool({
    description:
      "Create a new skill. IMPORTANT: Before creating, find 'Generator skill' in <skills> and use get_skill to load its instructions so you understand the proper skill structure and format. Use that structure when writing the skill content.",
    inputSchema: z.object({
      title: z
        .string()
        .describe("The skill title (5-8 words, action-oriented)"),
      content: z
        .string()
        .describe(
          "The full skill instructions in markdown. Follow the Generator skill structure.",
        ),
      short_description: z
        .string()
        .optional()
        .describe(
          "1-2 sentence description with trigger phrases (under 200 chars)",
        ),
    }),
    execute: async ({ title, content, short_description }) => {
      try {
        const skill = await createSkill(workspaceId, userId, {
          title,
          content,
          source: "agent",
          metadata: short_description
            ? { shortDescription: short_description }
            : undefined,
        });
        return `Skill created. ID: ${skill.id} | Title: ${skill.title}`;
      } catch (error) {
        logger.warn("Core agent: failed to create skill", { error });
        return "Failed to create skill";
      }
    },
  });
}

/**
 * Update an existing skill
 */
export function updateSkillTool(workspaceId: string, userId: string): Tool {
  return tool({
    description:
      "Update an existing skill's title, content, or short description. Use get_skill first to load the current content before making changes.",
    inputSchema: z.object({
      skill_id: z.string().describe("The ID of the skill to update"),
      title: z.string().optional().describe("New title for the skill"),
      content: z.string().optional().describe("New content/instructions"),
      short_description: z
        .string()
        .optional()
        .describe("New short description"),
    }),
    execute: async ({ skill_id, title, content, short_description }) => {
      try {
        const updated = await updateSkill(skill_id, workspaceId, userId, {
          ...(title && { title }),
          ...(content && { content }),
          ...(short_description && {
            metadata: { shortDescription: short_description },
          }),
        });
        if (!updated) return "Skill not found or update failed";
        return `Skill updated. ID: ${updated.id} | Title: ${updated.title}`;
      } catch (error) {
        logger.warn("Core agent: failed to update skill", { error });
        return "Failed to update skill";
      }
    },
  });
}
