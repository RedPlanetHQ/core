/**
 * MCP Skill Tools
 *
 * Provides list_skills and get_skill tools for MCP clients.
 *
 * Exposes a workspace's stored CORE skills so coding agents (Claude Code,
 * Codex, Cursor, ...) can discover and load skill instructions on demand
 * instead of users manually pasting skill content into their sessions.
 *
 */

import {
  listSkills,
  getSkill,
  findSkillBySlug,
} from "~/services/skills.server";
import { logger } from "~/services/logger.service";

function titleToSlug(title: string): string {
  return title
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "");
}

export const skillTools = [
  {
    name: "list_skills",
    description:
      "List the user's available CORE skills. Returns each skill's title, short description (if any), and ID. Use the returned IDs with get_skill to load full instructions. Paginated via optional cursor; default limit 50.",
    inputSchema: {
      type: "object",
      properties: {
        limit: {
          type: "number",
          description:
            "Maximum number of skills to return. Defaults to 30 if omitted.",
        },
        cursor: {
          type: "string",
          description:
            "Pagination cursor returned by a previous list_skills call. Omit on the first call.",
        },
      },
    },
    annotations: {
      readOnlyHint: true,
      idempotentHint: true,
      destructiveHint: false,
    },
  },
  {
    name: "get_skill",
    description:
      "Load a CORE skill's full instructions. Look up by skillId (preferred) OR by name (the skill's title; matched case-insensitively against a slugified form). Returns the skill title followed by its markdown content. Use this when the user asks to run / apply / follow a saved skill, or when you need a stored procedure or set of rules to complete a task.",
    inputSchema: {
      type: "object",
      properties: {
        skillId: {
          type: "string",
          description: "The skill's ID (preferred). Get IDs via list_skills.",
        },
        name: {
          type: "string",
          description:
            "The skill's title. Used only when skillId is not provided. Matched case-insensitively against existing skill titles.",
        },
      },
    },
    annotations: {
      readOnlyHint: true,
      idempotentHint: true,
      destructiveHint: false,
    },
  },
];

export async function callSkillTool(
  toolName: string,
  args: any,
  workspaceId: string,
) {
  try {
    switch (toolName) {
      case "list_skills": {
        const { limit, cursor } = args ?? {};
        logger.info(`Listing skills for workspace ${workspaceId}`);

        const result = await listSkills(workspaceId, { limit, cursor });

        if (result.skills.length === 0) {
          return {
            content: [{ type: "text", text: "No skills found." }],
          };
        }

        const skillsList = result.skills
          .map((s, i) => {
            const meta = (s.metadata as Record<string, unknown>) ?? {};
            const shortDescription =
              typeof meta.shortDescription === "string"
                ? ` — ${meta.shortDescription}`
                : "";
            return `${i + 1}. ${s.title}${shortDescription} [id:${s.id}]`;
          })
          .join("\n");

        const footer =
          result.hasMore && result.nextCursor
            ? `\n\nMore results available. Pass cursor=${result.nextCursor} to list_skills to fetch the next page.`
            : "";

        return {
          content: [
            {
              type: "text",
              text: `Skills (${result.skills.length} of ${result.totalCount}):\n${skillsList}${footer}`,
            },
          ],
        };
      }

      case "get_skill": {
        const { skillId, name } = args ?? {};

        if (!skillId && !name) {
          return {
            content: [
              {
                type: "text",
                text: "Provide either skillId or name to look up a skill.",
              },
            ],
            isError: true,
          };
        }

        logger.info(
          `Getting skill for workspace ${workspaceId} (skillId=${skillId ?? "-"}, name=${name ?? "-"})`,
        );

        let skill: { id: string; title: string; content: string } | null = null;

        if (skillId) {
          const found = await getSkill(skillId, workspaceId);
          if (found) {
            skill = {
              id: found.id,
              title: found.title,
              content: found.content,
            };
          }
        }

        if (!skill && name) {
          skill = await findSkillBySlug(workspaceId, titleToSlug(name));
        }

        if (!skill) {
          return {
            content: [{ type: "text", text: "Skill not found." }],
            isError: true,
          };
        }

        return {
          content: [
            {
              type: "text",
              text: `## Skill: ${skill.title}\n\n${skill.content}`,
            },
          ],
        };
      }

      default:
        return {
          content: [{ type: "text", text: `Unknown skill tool: ${toolName}` }],
          isError: true,
        };
    }
  } catch (error) {
    logger.error("Skill tool error", {
      error,
      toolName,
      workspaceId,
    });
    return {
      content: [
        {
          type: "text",
          text: `Failed to ${toolName}: ${error instanceof Error ? error.message : "Unknown error"}`,
        },
      ],
      isError: true,
    };
  }
}
