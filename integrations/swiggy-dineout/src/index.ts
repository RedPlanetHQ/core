import {
  IntegrationCLI,
  IntegrationEventPayload,
  IntegrationEventType,
  McpAuthParams,
  Spec,
} from "@redplanethq/sdk";

import { integrationCreate } from "./account-create";
import { callTool, getTools } from "./mcp";
import { fileURLToPath } from "url";

export async function run(eventPayload: IntegrationEventPayload) {
  switch (eventPayload.event) {
    case IntegrationEventType.SETUP:
      return await integrationCreate(eventPayload.eventBody);

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

class SwiggyDineoutCLI extends IntegrationCLI {
  constructor() {
    super("swiggy-dineout", "1.0.0");
  }

  protected async handleEvent(eventPayload: IntegrationEventPayload): Promise<any> {
    return await run(eventPayload);
  }

  protected async getSpec(): Promise<Spec> {
    return {
      name: "Swiggy Dineout",
      key: "swiggy-dineout",
      description:
        "Reserve restaurant tables on Swiggy Dineout. Search restaurants, check available slots, and book tables.",
      icon: "swiggy-dineout",
      auth: {
        mcp: {
          server_url: "https://mcp.swiggy.com/dineout",
        } as McpAuthParams,
      },
    };
  }
}

function main() {
  const cli = new SwiggyDineoutCLI();
  cli.parse();
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
