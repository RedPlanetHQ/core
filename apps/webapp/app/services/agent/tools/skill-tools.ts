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
import { createAgent, resolveModelString } from "~/lib/model.server";
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
 * Two paths:
 * 1. `content` provided — saves directly (context skills: preferences, rules, persona, domain knowledge)
 * 2. `intent` provided — runs the skill generator to produce a structured workflow, then saves
 */
export function createSkillTool(workspaceId: string, userId: string): Tool {
  return tool({
    description:
      "Save a reusable capability — structured knowledge, rules, preferences, or a repeatable workflow. Use this ONLY when there is something worth reusing in future conversations. NEVER use this for reminders, follow-ups, or scheduled notifications — those are tasks (use create_task with a schedule instead).",
    inputSchema: z.object({
      title: z
        .string()
        .describe("The skill title — concise and descriptive"),
      intent: z
        .string()
        .optional()
        .describe(
          "For repeatable workflow skills only: describe the reusable procedure — what it does, the steps involved, which tools to use, and when to apply it. Example: 'How to draft and send investor updates: pull last email for format reference, gather metrics, draft following the 6-section structure, confirm numbers with user, send.' Do NOT use this field for one-time actions, reminders, or scheduling requests.",
        ),
      content: z
        .string()
        .optional()
        .describe(
          "For knowledge/context skills: the full content to save directly — use this for captured knowledge, format templates, preferences, rules, persona, or domain expertise. Saved as-is without running through the generator. Example: the investor update format structure, email tone rules, code review checklist.",
        ),
      short_description: z
        .string()
        .optional()
        .describe(
          "1-2 sentence description with trigger phrases (under 200 chars)",
        ),
    }),
    execute: async ({ title, intent, content, short_description }) => {
      try {
        if (!content && !intent) {
          return "Failed to create skill: provide either content (for context skills) or intent (for workflow skills).";
        }

        let skillContent: string;

        if (content) {
          // Direct save path — context skills bypass the generator
          skillContent = content;
        } else {
          // Generator path — workflow skills get structured content
          const accounts = await getConnectedIntegrationAccounts(userId, workspaceId);
          const connectedTools = accounts.map((a) => a.integrationDefinition.name);
          const toolsContext = connectedTools.length > 0
            ? `\n\nUser's connected tools: ${connectedTools.join(", ")}`
            : "";

          const userMessage = `User intent: ${intent}${toolsContext}`;

          const agent = createAgent(await resolveModelString("chat", "low"), SKILL_GENERATOR_SYSTEM_PROMPT);
          const { text: generatedContent } = await agent.generate(userMessage);

          if (!generatedContent) {
            return "Failed to generate skill content — generator produced no output.";
          }

          skillContent = generatedContent;
        }

        const skill = await createSkill(workspaceId, userId, {
          title,
          content: skillContent,
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
