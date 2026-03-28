import { type Tool, tool, readUIMessageStream, type UIMessage, generateText, stepCountIs } from "ai";
import { z } from "zod";

import { runOrchestrator } from "./orchestrator";
import { type SkillRef } from "./types";
import { type OrchestratorTools } from "./orchestrator-tools";
import {
  type Trigger,
  type DecisionContext,
} from "./types/decision-agent";
import {
  parseActionPlan,
  normalizeActionPlan,
  createFallbackPlan,
} from "./decision-agent";
import { buildDecisionAgentPrompt } from "./prompts";
import { getModel, getModelForTask } from "~/lib/model.server";

import { logger } from "../logger.service";
import { prisma } from "~/db.server";
import { getReminderTools } from "./tools/reminder-tools";
import { type WorkspaceChannelContext } from "~/services/channel.server";

import {
  getSkillTool,
  createSkillTool,
  updateSkillTool,
} from "./tools/skill-tools";
import { getTaskTools } from "./tools/task-tools";
import { getSleepTool } from "./tools/utils-tools";

/**
 * Recursively checks if a message contains any tool part with state "approval-requested"
 */
const hasApprovalRequested = (message: UIMessage): boolean => {
  const checkParts = (parts: any[]): boolean => {
    for (const part of parts) {
      if (part.state === "approval-requested") {
        return true;
      }
      // Check nested output.parts (sub-agent responses)
      if (part.output?.parts && Array.isArray(part.output.parts)) {
        if (checkParts(part.output.parts)) return true;
      }
      // Check nested output.content
      if (part.output?.content && Array.isArray(part.output.content)) {
        if (checkParts(part.output.content)) return true;
      }
    }
    return false;
  };

  return message.parts ? checkParts(message.parts) : false;
};

export const createTools = async (
  userId: string,
  workspaceId: string,
  timezone: string,
  source: string,
  readOnly: boolean = false,
  persona?: string,
  skills?: SkillRef[],
  /** Optional callback for channels to send intermediate messages (acks) */
  onMessage?: (message: string) => Promise<void>,
  /** Channel context from getWorkspaceChannelContext() */
  channelCtx?: WorkspaceChannelContext,
  /** Conversation ID for web channel callbacks */
  conversationId?: string,
  /** Additional channel metadata for callbacks */
  channelMetadata?: Record<string, unknown>,
  /** Optional executor tools — uses HttpOrchestratorTools for trigger/job contexts */
  executorTools?: OrchestratorTools,
  /** Trigger context — when present, adds the `think` tool for decision-making */
  triggerContext?: {
    trigger: Trigger;
    context: DecisionContext;
    userPersona?: string;
  },
  /** When true, removes run_task_in_background to prevent infinite loops */
  isBackgroundExecution?: boolean,
) => {
  const tools: Record<string, Tool> = {
    gather_context: tool({
      description: `Search memory, connected integrations, the web, AND connected gateways (user's devices like Claude Code, browser, etc.). This is how you access information.

      FIVE DATA SOURCES:
      1. Memory: past conversations, decisions, user preferences
      2. Integrations: user's emails, calendar, issues, messages (their personal data)
      3. Web: news, current events, documentation, prices, weather, general knowledge, AND reading URLs
      4. Gateways: user's connected devices/agents (e.g., Claude Code on their laptop, browser agent) - use for tasks on their machine
      5. CORE Docs: your own documentation — how things work in your system, setup steps, integrations, troubleshooting. Use this when they ask about YOU.

      IMPORTANT: Each call handles ONE data source effectively. If you need data from multiple integrations (e.g., Gmail AND Calendar), make SEPARATE gather_context calls — one per integration. You can call them in parallel.

      WHEN TO USE:
      - Before saying "i don't know" - you might know it
      - When user asks about past conversations, decisions, preferences
      - When user asks about live data (emails, calendar, issues, etc.)
      - When user asks about news, current events, how-tos, or general questions
      - When user shares a URL and wants you to read/summarize it
      - When user asks to do something on their device/machine (coding tasks, file operations, browser actions)
      - When user asks about YOUR features, integrations, setup, channels, gateway, toolkit — anything about CORE itself

      HOW TO FORM YOUR QUERY:
      Describe your INTENT clearly. One integration/source per query.

      EXAMPLES:
      - "What meetings does user have this week" → integrations (calendar)
      - "What did we discuss about the deployment" → memory
      - "Latest tech news and AI updates" → web search
      - "What's the weather in SF" → web search
      - "Summarize this article: https://example.com/post" → web (fetches URL)
      - "User's unread emails from GitHub" → integrations (gmail)
      - "Check the status of user's local dev server" → gateway (connected device)
      - "How do I connect WhatsApp to CORE" → CORE docs
      - "What is the gateway" → CORE docs

      For URLs: include the full URL in your query.
      For GENERAL NEWS/INFO: the orchestrator will use web search.
      For USER-SPECIFIC data: it uses integrations.
      For DEVICE/MACHINE tasks: it uses gateways.`,
      inputSchema: z.object({
        query: z
          .string()
          .describe(
            "Your intent - what you're looking for and why. Describe it like you're asking a colleague to find something.",
          ),
      }),

      execute: async function* ({ query }, { abortSignal }) {
        logger.info(`Core brain: Gathering context for: ${query}`);

        const { stream } = await runOrchestrator(
          userId,
          workspaceId,
          query,
          "read",
          timezone,
          source,
          abortSignal,
          persona,
          skills,
          executorTools,
        );

        // Stream the orchestrator's work to the UI
        let approvalRequested = false;
        for await (const message of readUIMessageStream({
          stream: stream.toUIMessageStream(),
        })) {
          // Skip yielding if we already detected approval (but consume stream to avoid errors)
          if (approvalRequested) {
            continue;
          }

          yield message;

          // Check if this message has approval requested
          if (hasApprovalRequested(message)) {
            logger.info(
              `Core brain: Stopping gather_context - approval requested`,
            );
            approvalRequested = true;
          }
        }
      },
    }),
  };

  if (!readOnly) {
    tools["take_action"] = tool({
      description: `Execute actions on user's connected integrations AND gateways (connected devices).
      Use this to CREATE/SEND/UPDATE/DELETE: gmail filters/labels, calendar events, github issues, slack messages, notion pages.
      Gateways (e.g. Claude Code on their laptop, browser agent) are also available here for device/machine operations.
      Examples: "post message to slack #team-updates saying deployment complete", "block friday 3pm on calendar for 1:1 with sarah", "create github issue in core repo titled fix auth timeout"
      When user confirms they want something done, use this tool to do it.
      For SKILLS: when executing a skill, include the skill name and ID. Example: "Execute skill 'Plan My Day' (skill_id: abc123)"

      NOTE: For coding tasks, research, browser automation, or anything that takes time — default to create_task + run_task_in_background. Only use take_action directly for these if the user explicitly says to run it inline (e.g. "do it here", "don't background it").`,
      inputSchema: z.object({
        action: z
          .string()
          .describe(
            "The action to perform. Be specific: include integration, what to create/send/update, and all details.",
          ),
      }),
      execute: async function* ({ action }, { abortSignal }) {
        logger.info(`Core brain: Taking action: ${action}`);

        const { stream } = await runOrchestrator(
          userId,
          workspaceId,
          action,
          "write",
          timezone,
          source,
          abortSignal,
          persona,
          skills,
          executorTools,
        );

        // Stream the orchestrator's work to the UI
        let approvalRequested = false;
        for await (const message of readUIMessageStream({
          stream: stream.toUIMessageStream(),
        })) {
          // Skip yielding if we already detected approval (but consume stream to avoid errors)
          if (approvalRequested) {
            continue;
          }

          yield message;

          // Check if this message has approval requested
          if (hasApprovalRequested(message)) {
            logger.info(
              `Core brain: Stopping take_action - approval requested`,
            );
            approvalRequested = true;
          }
        }
      },
    });
  }

  // Sleep tool — available to the main core-agent for polling/retry patterns
  tools["sleep"] = getSleepTool();

  // Add acknowledge tool for channels with intermediate message support
  if (onMessage) {
    tools["acknowledge"] = tool({
      description:
        "Send a quick heads-up to the user on their channel before you start working. Call this BEFORE gather_context or take_action so they know you're on it. One short message per conversation — don't spam.",
      inputSchema: z.object({
        message: z
          .string()
          .describe(
            'One short sentence. Max 6 words. Examples: "on it.", "let me check.", "looking into it.", "one sec."',
          ),
      }),
      execute: async ({ message }) => {
        logger.info(`Core brain: Acknowledging: ${message}`);
        await onMessage(message);
        return "acknowledged";
      },
    });
  }

  // Add reminder management tools
  // WhatsApp/Slack source → same channel type, everything else → workspace default
  const defaultChannelType = channelCtx?.defaultChannelType ?? "email";
  const channel =
    source === "whatsapp"
      ? "whatsapp"
      : source === "slack"
        ? "slack"
        : defaultChannelType;
  // Look up plan type to enforce minimum recurrence interval
  const subscription = await prisma.subscription.findFirst({
    where: {
      workspace: { id: workspaceId },
      status: "ACTIVE",
    },
    select: { planType: true },
  });
  const minRecurrenceMinutes =
    subscription?.planType === "FREE" || !subscription ? 60 : 30;

  const reminderTools = getReminderTools(
    workspaceId,
    channel,
    timezone,
    channelCtx?.availableTypes || ["email"],
    minRecurrenceMinutes,
    channelCtx?.channels,
  );

  const taskTools = readOnly ? {} : getTaskTools(workspaceId, userId, isBackgroundExecution);

  // Skill tools — get_skill always available (skills can be created mid-conversation or referenced by ID)
  tools["get_skill"] = getSkillTool(workspaceId);

  if (!readOnly) {
    tools["create_skill"] = createSkillTool(workspaceId, userId);
    tools["update_skill"] = updateSkillTool(workspaceId, userId);
  }

  // Think tool — butler's decision layer for non-user triggers
  if (triggerContext) {
    tools["think"] = tool({
      description: `Analyze a trigger (reminder, webhook, scheduled event) and decide what needs to happen. Call this FIRST before doing anything else when a trigger fires. Returns an ActionPlan with shouldMessage, intent, tone, and context.`,
      inputSchema: z.object({}),
      execute: async () => {
        const { trigger, context, userPersona } = triggerContext;

        try {
          const currentTime = new Date().toLocaleString("en-US", {
            timeZone: timezone,
            dateStyle: "full",
            timeStyle: "short",
          });

          const triggerJson = JSON.stringify(trigger, null, 2);
          const contextJson = JSON.stringify(
            {
              user: context.user,
              todayState: context.todayState,
              relevantHistory: context.relevantHistory,
              gatheredData: context.gatheredData,
            },
            null,
            2,
          );

          const prompt = buildDecisionAgentPrompt(
            triggerJson,
            contextJson,
            currentTime,
            timezone,
            userPersona,
            skills,
          );

          // Think uses cheap/fast model
          const thinkModel = getModel(getModelForTask("low"));

          // Build tools for think: gather_context (read-only), get_skill, reminder tools
          const thinkTools: Record<string, Tool> = {
            gather_context: tools["gather_context"],
            get_skill: tools["get_skill"],
            ...reminderTools,
          };

          const { text } = await generateText({
            model: thinkModel as any,
            messages: [{ role: "user", content: prompt }],
            tools: thinkTools,
            stopWhen: stepCountIs(5),
          });

          const parsedPlan = parseActionPlan(text);

          if (!parsedPlan) {
            logger.warn("Think tool: invalid output, using fallback", {
              triggerType: trigger.type,
              responsePreview: text.substring(0, 200),
            });
            return createFallbackPlan(trigger);
          }

          const plan = normalizeActionPlan(parsedPlan);

          logger.info("Think tool: decision made", {
            triggerType: trigger.type,
            shouldMessage: plan.shouldMessage,
            reasoning: plan.reasoning,
          });

          return plan;
        } catch (error) {
          logger.error("Think tool: failed", { error });
          return createFallbackPlan(triggerContext.trigger);
        }
      },
    });
  }

  return { ...tools, ...reminderTools, ...taskTools };
};
