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
import { createAgent, getModelForTask } from "~/lib/model.server";
import { getConnectedIntegrationAccounts } from "~/services/integrationAccount.server";
import { SKILL_GENERATOR_SYSTEM_PROMPT } from "~/utils/skill-generator-prompt";

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
 *
 * The butler provides the intent — the tool internally runs the skill generator
 * to produce a properly structured workflow, then saves it.
 */
export function createSkillTool(workspaceId: string, userId: string): Tool {
  return tool({
    description:
      "Create a new skill (reusable workflow). Provide the title and a description of what the workflow should do — the system will generate the structured workflow content automatically. You don't need to write the full workflow yourself.",
    inputSchema: z.object({
      title: z
        .string()
        .describe("The skill title (5-8 words, action-oriented)"),
      intent: z
        .string()
        .describe(
          "Describe what this workflow should do — the steps, rules, tools to use, and expected output. Be specific about the workflow logic.",
        ),
      short_description: z
        .string()
        .optional()
        .describe(
          "1-2 sentence description with trigger phrases (under 200 chars)",
        ),
    }),
    execute: async ({ title, intent, short_description }) => {
      try {
        // Fetch connected tools for context
        const accounts = await getConnectedIntegrationAccounts(userId, workspaceId);
        const connectedTools = accounts.map((a) => a.integrationDefinition.name);
        const toolsContext = connectedTools.length > 0
          ? `\n\nUser's connected tools: ${connectedTools.join(", ")}`
          : "";

        const userMessage = `User intent: ${intent}${toolsContext}`;

        // Generate structured workflow via the skill generator
        const agent = createAgent(getModelForTask("low"), SKILL_GENERATOR_SYSTEM_PROMPT);
        const { text: generatedContent } = await agent.generate(userMessage);

        if (!generatedContent) {
          return "Failed to generate skill workflow — generator produced no output.";
        }

        const skill = await createSkill(workspaceId, userId, {
          title,
          content: generatedContent,
          source: "agent",
          metadata: short_description
            ? { shortDescription: short_description }
            : undefined,
        });
        return `Skill created. ID: ${skill.id} | Title: ${skill.title}`;
      } catch (error) {
        logger.warn("Core agent: failed to create skill", { error });
        return `Failed to create skill: ${error instanceof Error ? error.message : "Unknown error"}`;
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
