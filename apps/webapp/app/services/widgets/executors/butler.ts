/**
 * runButlerOnce — fires the Butler (core agent) loop with a single user
 * message and returns its final assistant text.
 *
 * Stateless by design: no Conversation row, no ConversationHistory writes,
 * no asyncJob. The Butler's full toolset is wired up (gather_context,
 * take_action, gateway, widget_builder, skill_builder, tasks, skills, etc.)
 * and runs in always-approved mode (`interactive: false`) so widget
 * requests don't pop confirmation prompts on the user.
 *
 * Credits ARE deducted (one chatMessage per call, non-BYOK only) — the LLM
 * call costs the workspace whether or not we record the message, so we
 * mirror the chat path's billing. BYOK workspaces pay their provider
 * directly and skip the deduction.
 *
 * Equivalent in capability to messaging the Butler in chat — just without
 * the chat sidebar, history, or any persisted artifact of the call.
 */

import { Agent, convertMessages } from "@mastra/core/agent";
import type { OutputProcessor } from "@mastra/core/processors";
import { generateId, stepCountIs } from "ai";

import { buildAgentContext } from "~/services/agent/context";
import { getMastra } from "~/services/agent/mastra";
import {
  generateWithRetry,
  describeAgentError,
} from "~/services/agent/context-window";
import { resolveModelConfig } from "~/services/llm-provider.server";
import { getDefaultChatModelId } from "~/services/llm-provider.server";
import { logger } from "~/services/logger.service";
import { deductCredits } from "~/trigger/utils/utils";

export interface RunButlerOnceOptions {
  workspaceId: string;
  userId: string;
  /** Single user-turn message — already-resolved prompt text. */
  prompt: string;
  /** Telemetry/source label, e.g. "widget:ai.text:<requestId>". */
  source?: string;
}

export interface RunButlerOnceResult {
  ok: boolean;
  text?: string;
  error?: string;
}

export async function runButlerOnce(
  opts: RunButlerOnceOptions,
): Promise<RunButlerOnceResult> {
  // Fake conversation id — buildAgentContext only uses it to look up an
  // optional asyncJob/linkedTask row, both of which we want absent. Using a
  // fresh UUID keeps the lookup clean (returns null) without minting a real
  // Conversation row.
  const fakeConversationId = generateId();

  const userMessageId = generateId();
  const finalMessages = [
    {
      id: userMessageId,
      role: "user" as const,
      parts: [{ type: "text", text: opts.prompt }],
    },
  ];

  const modelString = getDefaultChatModelId();
  const { modelConfig, isBYOK } = await resolveModelConfig(
    modelString,
    opts.workspaceId,
  );

  const {
    systemPrompt,
    tools,
    modelMessages,
    gatherContextAgent,
    takeActionAgent,
    thinkAgent,
    gatewayAgents,
    widgetBuilderAgent,
    skillBuilderAgent,
  } = await buildAgentContext({
    userId: opts.userId,
    workspaceId: opts.workspaceId,
    source: "widget" as any,
    finalMessages,
    conversationId: fakeConversationId,
    interactive: false,
    modelConfig,
  });

  const subagents: Record<string, Agent> = {
    gather_context: gatherContextAgent,
    take_action: takeActionAgent,
    widget_builder: widgetBuilderAgent,
    skill_builder: skillBuilderAgent,
  };
  if (thinkAgent) subagents.think = thinkAgent;
  for (const gw of gatewayAgents) subagents[gw.id] = gw;

  const agent = new Agent({
    id: "core-agent",
    name: "Core Agent",
    model: modelConfig as any,
    instructions: systemPrompt,
    agents: subagents,
  });

  const mastra = getMastra();
  (agent as any).__registerMastra(mastra);
  (gatherContextAgent as any).__registerMastra(mastra);
  (takeActionAgent as any).__registerMastra(mastra);
  (widgetBuilderAgent as any).__registerMastra(mastra);
  (skillBuilderAgent as any).__registerMastra(mastra);
  if (thinkAgent) (thinkAgent as any).__registerMastra(mastra);
  for (const gw of gatewayAgents) (gw as any).__registerMastra(mastra);

  let capturedText = "";
  const captureProcessor: OutputProcessor = {
    id: "widget-butler-capture",
    async processInput({ messages }: any) {
      return messages;
    },
    async processOutputResult({ messages }: any) {
      const converted = convertMessages(messages).to("AIV6.UI") as any[];
      const lastMsg = converted[converted.length - 1];
      const parts = lastMsg?.parts ?? [];
      capturedText = parts
        .filter((p: any) => p.type === "text")
        .map((p: any) => p.text)
        .join("");
      return messages;
    },
  };

  try {
    await generateWithRetry({
      agent,
      modelMessages: modelMessages as unknown[],
      generateOptions: {
        toolsets: { core: tools },
        stopWhen: [stepCountIs(10)],
        modelSettings: { temperature: 0.5 },
        outputProcessors: [captureProcessor],
      },
      conversationId: fakeConversationId,
    });
  } catch (error) {
    const { userMessage } = describeAgentError(error);
    logger.warn("widget butler call failed", {
      source: opts.source,
      error: error instanceof Error ? error.message : String(error),
    });
    return { ok: false, error: userMessage };
  }

  // Bill the workspace for the LLM call. Mirrors no-stream-process.ts —
  // BYOK workspaces pay their provider directly and skip this. We bill
  // post-success so a failed generate doesn't burn credits.
  if (!isBYOK) {
    try {
      await deductCredits(opts.workspaceId, opts.userId, "chatMessage", 1);
    } catch (err) {
      // Don't fail the widget call on a billing hiccup — just warn.
      logger.warn("widget butler credit deduction failed", {
        source: opts.source,
        workspaceId: opts.workspaceId,
        err,
      });
    }
  }

  return { ok: true, text: capturedText };
}
