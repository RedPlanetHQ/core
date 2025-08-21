/* eslint-disable @typescript-eslint/no-explicit-any */

import { ActionStatusEnum } from "@core/types";
import { logger } from "@trigger.dev/sdk/v3";
import {
  type CoreMessage,
  type DataContent,
  jsonSchema,
  tool,
  type ToolSet,
} from "ai";
import axios from "axios";
import Handlebars from "handlebars";

import { REACT_SYSTEM_PROMPT, REACT_USER_PROMPT } from "./prompt";
import { generate, processTag } from "./stream-utils";
import { type AgentMessage, AgentMessageType, Message } from "./types";
import { type MCP } from "../utils/mcp";
import {
  WebSearchSchema,
  type ExecutionState,
  type HistoryStep,
  type Resource,
  type TotalCost,
} from "../utils/types";
import { flattenObject, webSearch } from "../utils/utils";
import { searchMemory, addMemory, searchSpaces } from "./memory-utils";

interface LLMOutputInterface {
  response: AsyncGenerator<
    | string
    | {
        type: string;
        toolName: string;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        args?: any;
        toolCallId?: string;
        message?: string;
      },
    any,
    any
  >;
}

const progressUpdateTool = tool({
  description:
    "Send a progress update to the user about what has been discovered or will be done next in a crisp and user friendly way no technical terms",
  parameters: jsonSchema({
    type: "object",
    properties: {
      message: {
        type: "string",
        description: "The progress update message to send to the user",
      },
    },
    required: ["message"],
    additionalProperties: false,
  }),
});

const searchMemoryTool = tool({
  description:
    "Search the user's memory graph for episodes or statements based on a query",
  parameters: jsonSchema({
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "The search query in third person perspective",
      },
      validAt: {
        type: "string",
        description: "The valid at time in ISO format",
      },
      startTime: {
        type: "string",
        description: "The start time in ISO format",
      },
      endTime: {
        type: "string",
        description: "The end time in ISO format",
      },
      spaceIds: {
        type: "array",
        items: {
          type: "string",
          format: "uuid",
        },
        description: "Array of strings representing UUIDs of spaces",
      },
    },
    required: ["query"],
    additionalProperties: false,
  }),
});

const addMemoryTool = tool({
  description: "Add information to the user's memory graph",
  parameters: jsonSchema({
    type: "object",
    properties: {
      message: {
        type: "string",
        description: "The content/text to add to memory",
      },
    },
    required: ["message"],
    additionalProperties: false,
  }),
});

const searchSpacesTool = tool({
  description: "Get spaces in memory",
  parameters: jsonSchema({
    type: "object",
    properties: {},
    required: [],
    additionalProperties: false,
  }),
});

const websearchTool = tool({
  description:
    "Search the web for current information and news. Use this when you need up-to-date information that might not be in your training data. Try different search strategies: broad terms first, then specific phrases, keywords, exact quotes. Use multiple searches with varied approaches to get comprehensive results.",
  parameters: WebSearchSchema,
});

const loadMCPTools = tool({
  description:
    "Load tools for a specific integration. Call this when you need to use a third-party service.",
  parameters: jsonSchema({
    type: "object",
    properties: {
      integration: {
        type: "array",
        items: {
          type: "string",
        },
        description:
          'Array of integration names to load (e.g., ["github", "linear", "slack"])',
      },
    },
    required: ["integration"],
    additionalProperties: false,
  }),
});

const internalTools = [
  "core--progress_update",
  "core--search_memory",
  "core--add_memory",
  "core--load_mcp",
];

async function addResources(messages: CoreMessage[], resources: Resource[]) {
  const resourcePromises = resources.map(async (resource) => {
    // Remove everything before "/api" in the publicURL
    if (resource.publicURL) {
      const apiIndex = resource.publicURL.indexOf("/api");
      if (apiIndex !== -1) {
        resource.publicURL = resource.publicURL.substring(apiIndex);
      }
    }
    const response = await axios.get(resource.publicURL, {
      responseType: "arraybuffer",
    });

    if (resource.fileType.startsWith("image/")) {
      return {
        type: "image",
        image: response.data as DataContent,
      };
    }

    return {
      type: "file",
      data: response.data as DataContent,

      mimeType: resource.fileType,
    };
  });

  const content = await Promise.all(resourcePromises);

  return [...messages, { role: "user", content } as CoreMessage];
}

function toolToMessage(history: HistoryStep[], messages: CoreMessage[]) {
  for (let i = 0; i < history.length; i++) {
    const step = history[i];

    // Add assistant message with tool calls
    if (step.observation && step.skillId) {
      messages.push({
        role: "assistant",
        content: [
          {
            type: "tool-call",
            toolCallId: step.skillId,
            toolName: step.skill ?? "",
            args:
              typeof step.skillInput === "string"
                ? JSON.parse(step.skillInput)
                : step.skillInput,
          },
        ],
      });

      messages.push({
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolName: step.skill,
            toolCallId: step.skillId,
            result: step.observation,
            isError: step.isError,
          },
        ],
      } as any);
    }
    // Handle format correction steps (observation exists but no skillId)
    else if (step.observation && !step.skillId) {
      // Add as a system message for format correction
      messages.push({
        role: "system",
        content: step.observation,
      });
    }
  }

  return messages;
}

async function makeNextCall(
  executionState: ExecutionState,
  TOOLS: ToolSet,
  totalCost: TotalCost,
  guardLoop: number,
  mcpServers: string[],
): Promise<LLMOutputInterface> {
  const { context, history, previousHistory } = executionState;

  const promptInfo = {
    USER_MESSAGE: executionState.query,
    CONTEXT: context,
    USER_MEMORY: executionState.userMemoryContext,
    AVAILABLE_MCP_TOOLS: mcpServers.join(", "),
  };

  let messages: CoreMessage[] = [];

  const systemTemplateHandler = Handlebars.compile(REACT_SYSTEM_PROMPT);
  let systemPrompt = systemTemplateHandler(promptInfo);

  const userTemplateHandler = Handlebars.compile(REACT_USER_PROMPT);
  const userPrompt = userTemplateHandler(promptInfo);

  // Always start with a system message (this does use tokens but keeps the instructions clear)
  messages.push({ role: "system", content: systemPrompt });

  // For subsequent queries, include only final responses from previous exchanges if available
  if (previousHistory && previousHistory.length > 0) {
    messages = [...messages, ...previousHistory];
  }

  // Add the current user query (much simpler than the full prompt)
  messages.push({ role: "user", content: userPrompt });

  // Include any steps from the current interaction
  if (history.length > 0) {
    messages = toolToMessage(history, messages);
  }

  if (executionState.resources && executionState.resources.length > 0) {
    messages = await addResources(messages, executionState.resources);
  }

  // Get the next action from the LLM
  const response = generate(
    messages,
    guardLoop > 0 && guardLoop % 3 === 0,
    (event) => {
      const usage = event.usage;
      totalCost.inputTokens += usage.promptTokens;
      totalCost.outputTokens += usage.completionTokens;
    },
    TOOLS,
  );

  return { response };
}

export async function* run(
  message: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  context: Record<string, any>,
  previousHistory: CoreMessage[],
  mcp: MCP,
  stepHistory: HistoryStep[],
  mcpServers: string[],
  mcpHeaders: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): AsyncGenerator<AgentMessage, any, any> {
  let guardLoop = 0;

  let tools = {
    ...(await mcp.allTools()),
    "core--progress_update": progressUpdateTool,
    "core--search_memory": searchMemoryTool,
    "core--add_memory": addMemoryTool,
    "core--search_spaces": searchSpacesTool,
    "core--websearch": websearchTool,
    "core--load_mcp": loadMCPTools,
  };

  logger.info("Tools have been formed");

  let contextText = "";
  let resources = [];
  if (context) {
    // Extract resources and remove from context
    resources = context.resources || [];
    delete context.resources;

    // Process remaining context
    contextText = flattenObject(context).join("\n");
  }

  const executionState: ExecutionState = {
    query: message,
    context: contextText,
    resources,
    previousHistory,
    history: stepHistory, // Track the full ReAct history
    completed: false,
  };

  const totalCost: TotalCost = { inputTokens: 0, outputTokens: 0, cost: 0 };

  try {
    while (!executionState.completed && guardLoop < 50) {
      logger.info(`Starting the loop: ${guardLoop}`);

      const { response: llmResponse } = await makeNextCall(
        executionState,
        tools,
        totalCost,
        guardLoop,
        mcpServers,
      );

      let toolCallInfo;

      const messageState = {
        inTag: false,
        message: "",
        messageEnded: false,
        lastSent: "",
      };

      const questionState = {
        inTag: false,
        message: "",
        messageEnded: false,
        lastSent: "",
      };

      let totalMessage = "";
      const toolCalls = [];

      // LLM thought response
      for await (const chunk of llmResponse) {
        if (typeof chunk === "object" && chunk.type === "tool-call") {
          toolCallInfo = chunk;
          toolCalls.push(chunk);
        }

        totalMessage += chunk;

        if (!messageState.messageEnded) {
          yield* processTag(
            messageState,
            totalMessage,
            chunk as string,
            "<final_response>",
            "</final_response>",
            {
              start: AgentMessageType.MESSAGE_START,
              chunk: AgentMessageType.MESSAGE_CHUNK,
              end: AgentMessageType.MESSAGE_END,
            },
          );
        }

        if (!questionState.messageEnded) {
          yield* processTag(
            questionState,
            totalMessage,
            chunk as string,
            "<question_response>",
            "</question_response>",
            {
              start: AgentMessageType.MESSAGE_START,
              chunk: AgentMessageType.MESSAGE_CHUNK,
              end: AgentMessageType.MESSAGE_END,
            },
          );
        }
      }

      logger.info(`Cost for thought: ${JSON.stringify(totalCost)}`);

      // Replace the error-handling block with this self-correcting implementation
      if (
        !totalMessage.includes("final_response") &&
        !totalMessage.includes("question_response") &&
        !toolCallInfo
      ) {
        // Log the issue for debugging
        logger.info(
          `Invalid response format detected. Attempting to get proper format.`,
        );

        // Extract the raw content from the invalid response
        const rawContent = totalMessage
          .replace(/(<[^>]*>|<\/[^>]*>)/g, "")
          .trim();

        // Create a correction step
        const stepRecord: HistoryStep = {
          thought: "",
          skill: "",
          skillId: "",
          userMessage: "Sol agent error, retrying \n",
          isQuestion: false,
          isFinal: false,
          tokenCount: totalCost,
          skillInput: "",
          observation: `Your last response was not in a valid format. You must respond with EXACTLY ONE of the required formats: either a tool call, <question_response> tags, or <final_response> tags. Please reformat your previous response using the correct format:\n\n${rawContent}`,
        };

        yield Message("", AgentMessageType.MESSAGE_START);
        yield Message(
          stepRecord.userMessage as string,
          AgentMessageType.MESSAGE_CHUNK,
        );
        yield Message("", AgentMessageType.MESSAGE_END);

        // Add this step to the history
        yield Message(JSON.stringify(stepRecord), AgentMessageType.STEP);
        executionState.history.push(stepRecord);

        // Log that we're continuing the loop with a correction request
        logger.info(`Added format correction request to history.`);

        // Don't mark as completed - let the loop continue
        guardLoop++; // Still increment to prevent infinite loops
        continue;
      }

      // Record this step in history
      const stepRecord: HistoryStep = {
        thought: "",
        skill: "",
        skillId: "",
        userMessage: "",
        isQuestion: false,
        isFinal: false,
        tokenCount: totalCost,
        skillInput: "",
      };

      if (totalMessage && totalMessage.includes("final_response")) {
        executionState.completed = true;
        stepRecord.isFinal = true;
        stepRecord.userMessage = messageState.message;
        stepRecord.finalTokenCount = totalCost;
        stepRecord.skillStatus = ActionStatusEnum.SUCCESS;
        yield Message(JSON.stringify(stepRecord), AgentMessageType.STEP);
        executionState.history.push(stepRecord);
        break;
      }

      if (totalMessage && totalMessage.includes("question_response")) {
        executionState.completed = true;
        stepRecord.isQuestion = true;
        stepRecord.userMessage = questionState.message;
        stepRecord.finalTokenCount = totalCost;
        stepRecord.skillStatus = ActionStatusEnum.QUESTION;
        yield Message(JSON.stringify(stepRecord), AgentMessageType.STEP);
        executionState.history.push(stepRecord);
        break;
      }

      if (toolCalls && toolCalls.length > 0) {
        // Run all tool calls in parallel
        for (const toolCallInfo of toolCalls) {
          const skillName = toolCallInfo.toolName;
          const skillId = toolCallInfo.toolCallId;
          const skillInput = toolCallInfo.args;

          const toolName = skillName.split("--")[1];
          const agent = skillName.split("--")[0];

          const stepRecord: HistoryStep = {
            agent,
            thought: "",
            skill: skillName,
            skillId,
            userMessage: "",
            isQuestion: false,
            isFinal: false,
            tokenCount: totalCost,
            skillInput: JSON.stringify(skillInput),
          };

          if (!internalTools.includes(skillName)) {
            const skillMessageToSend = `\n<skill id="${skillId}" name="${toolName}" agent="${agent}"></skill>\n`;

            stepRecord.userMessage += skillMessageToSend;

            yield Message("", AgentMessageType.MESSAGE_START);
            yield Message(skillMessageToSend, AgentMessageType.MESSAGE_CHUNK);
            yield Message("", AgentMessageType.MESSAGE_END);
          }

          let result;
          try {
            // Log skill execution details
            logger.info(`Executing skill: ${skillName}`);
            logger.info(`Input parameters: ${JSON.stringify(skillInput)}`);

            if (!internalTools.includes(toolName)) {
              yield Message(
                JSON.stringify({ skillId, status: "start" }),
                AgentMessageType.SKILL_START,
              );
            }

            // Handle CORE agent tools
            if (agent === "core") {
              if (toolName === "progress_update") {
                yield Message("", AgentMessageType.MESSAGE_START);
                yield Message(
                  skillInput.message,
                  AgentMessageType.MESSAGE_CHUNK,
                );
                stepRecord.userMessage += skillInput.message;
                yield Message("", AgentMessageType.MESSAGE_END);
                result = "Progress update sent successfully";
              } else if (toolName === "search_memory") {
                try {
                  result = await searchMemory(skillInput);
                } catch (apiError) {
                  logger.error("Memory utils calls failed for search_memory", {
                    apiError,
                  });
                  result =
                    "Memory search failed - please check your memory configuration";
                }
              } else if (toolName === "add_memory") {
                try {
                  result = await addMemory(skillInput);
                } catch (apiError) {
                  logger.error("Memory utils calls failed for add_memory", {
                    apiError,
                  });
                  result =
                    "Memory storage failed - please check your memory configuration";
                }
              } else if (toolName === "search_spaces") {
                try {
                  result = await searchSpaces();
                } catch (apiError) {
                  logger.error("Search spaces call failed", {
                    apiError,
                  });
                  result = "Search spaces call failed";
                }
              } else if (toolName === "websearch") {
                try {
                  result = await webSearch(skillInput);
                } catch (apiError) {
                  logger.error("Web search failed", {
                    apiError,
                  });
                  result =
                    "Web search failed - please check your search configuration";
                }
              } else if (toolName === "load_mcp") {
                // Load MCP integration and update available tools
                await mcp.load(skillInput.integration, mcpHeaders);
                tools = {
                  ...tools,
                  ...(await mcp.allTools()),
                };
                result = "MCP integration loaded successfully";
              }
            }
            // Handle other MCP tools
            else {
              result = await mcp.callTool(skillName, skillInput);

              yield Message(
                JSON.stringify({ result, skillId }),
                AgentMessageType.SKILL_CHUNK,
              );
            }

            yield Message(
              JSON.stringify({ skillId, status: "end" }),
              AgentMessageType.SKILL_END,
            );

            stepRecord.skillOutput =
              typeof result === "object"
                ? JSON.stringify(result, null, 2)
                : result;
            stepRecord.observation = stepRecord.skillOutput;
          } catch (e) {
            console.log(e);
            logger.error(e as string);
            stepRecord.skillInput = skillInput;
            stepRecord.observation = JSON.stringify(e);
            stepRecord.isError = true;
          }

          logger.info(`Skill step: ${JSON.stringify(stepRecord)}`);

          yield Message(JSON.stringify(stepRecord), AgentMessageType.STEP);
          executionState.history.push(stepRecord);
        }
      }
      guardLoop++;
    }
    yield Message("Stream ended", AgentMessageType.STREAM_END);
  } catch (e) {
    logger.error(e as string);
    yield Message((e as Error).message, AgentMessageType.ERROR);
    yield Message("Stream ended", AgentMessageType.STREAM_END);
  }
}
