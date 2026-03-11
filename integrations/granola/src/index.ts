import {
  IntegrationCLI,
  IntegrationEventPayload,
  IntegrationEventType,
  McpAuthParams,
  Spec,
} from "@redplanethq/sdk";

import { integrationCreate } from "./account-create";
import { callTool, getTools } from "./mcp";
import { handleSchedule } from "./schedule";
import { fileURLToPath } from "url";

export async function run(eventPayload: IntegrationEventPayload) {
  switch (eventPayload.event) {
    case IntegrationEventType.SETUP:
      return await integrationCreate(eventPayload.eventBody);

    case IntegrationEventType.SYNC:
      return await handleSchedule(eventPayload.config, eventPayload.state);

    case IntegrationEventType.GET_TOOLS: {
      try {
        const config = eventPayload.config as Record<string, string>;
        const tools = await getTools(config);
        return tools;
      } catch (e: any) {
        return { message: `Error ${e.message}` };
      }
    }

    case IntegrationEventType.CALL_TOOL: {
      const integrationDefinition = eventPayload.integrationDefinition;

      if (!integrationDefinition) {
        return null;
      }

      const config = eventPayload.config as any;
      const { name, arguments: args } = eventPayload.eventBody;

      const result = await callTool(name, args, config);
      return result;
    }

    default:
      return { message: `The event payload type is ${eventPayload.event}` };
  }
}

class GranolaCLI extends IntegrationCLI {
  constructor() {
    super("granola", "1.0.0");
  }

  protected async handleEvent(eventPayload: IntegrationEventPayload): Promise<any> {
    return await run(eventPayload);
  }

  protected async getSpec(): Promise<Spec> {
    return {
      name: "Granola",
      key: "granola",
      description:
        "Sync AI meeting notes and transcripts from Granola into CORE. Access your meetings, summaries, and action items.",
      icon: "granola",
      auth: {
        mcp: {
          server_url: "https://mcp.granola.ai/mcp",
        } as McpAuthParams,
      },
    };
  }
}

function main() {
  const granolaCLI = new GranolaCLI();
  granolaCLI.parse();
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
