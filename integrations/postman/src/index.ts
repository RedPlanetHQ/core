import {
  IntegrationCLI,
  IntegrationEventPayload,
  IntegrationEventType,
  Spec,
} from "@redplanethq/sdk";
import { fileURLToPath } from "url";

import { integrationCreate } from "./account-create";
import { handleSchedule } from "./schedule";
import { callTool, getTools } from "./mcp";

export async function run(eventPayload: IntegrationEventPayload) {
  switch (eventPayload.event) {
    case IntegrationEventType.SETUP:
      return await integrationCreate(eventPayload.eventBody);

    case IntegrationEventType.SYNC:
      return await handleSchedule(
        (eventPayload.config ?? {}) as Record<string, any>,
        eventPayload.state as any
      );

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
      if (!eventPayload.integrationDefinition) return null;
      const config = eventPayload.config as any;
      const { name, arguments: args } = eventPayload.eventBody;
      const result = await callTool(name, args, config);
      return result;
    }

    default:
      return { message: `The event payload type is ${eventPayload.event}` };
  }
}

class PostmanCLI extends IntegrationCLI {
  constructor() {
    super("postman", "1.0.0");
  }

  protected async handleEvent(eventPayload: IntegrationEventPayload): Promise<any> {
    return await run(eventPayload);
  }

  protected async getSpec(): Promise<Spec> {
    return {
      name: "Postman",
      key: "postman",
      description:
        "Read-only Postman integration. Syncs workspaces, collections, environments, APIs, monitors, and mocks and exposes them as MCP tools to the agent.",
      icon: "postman",
      schedule: {
        frequency: "*/15 * * * *",
      },
      auth: {
        api_key: {
          fields: [
            {
              name: "api_key",
              label: "Postman API Key",
              placeholder: "PMAK-xxxxxxxxxxxxxxxxxxxxxxxxx",
              description: "Generate this in Postman → Settings → API Keys → Generate API Key.",
            },
          ],
        },
      },
    };
  }
}

function main() {
  new PostmanCLI().parse();
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
