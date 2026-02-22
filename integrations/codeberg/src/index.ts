import { handleSchedule } from "./schedule";
import { integrationCreate } from "./account-create";

import {
  IntegrationCLI,
  IntegrationEventPayload,
  IntegrationEventType,
  Spec,
} from "@redplanethq/sdk";
import { callTool, getTools } from "./mcp";

export async function run(eventPayload: IntegrationEventPayload) {
  switch (eventPayload.event) {
    case IntegrationEventType.SETUP:
      return await integrationCreate(eventPayload.eventBody);

    case IntegrationEventType.SYNC:
      return await handleSchedule(eventPayload.config, eventPayload.state);

    case IntegrationEventType.GET_TOOLS: {
      try {
        const tools = await getTools();

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

// CLI implementation that extends the base class
class CodebergCLI extends IntegrationCLI {
  constructor() {
    super("codeberg", "0.1.0");
  }

  protected async handleEvent(eventPayload: IntegrationEventPayload): Promise<any> {
    return await run(eventPayload);
  }

  protected async getSpec(): Promise<Spec> {
    return {
      name: "Codeberg",
      key: "codeberg",
      description:
        "Manage your repositories and issues on Codeberg.org, a community-driven git hosting.",
      icon: "codeberg", // Note: You might need to add this icon to the webapp if it doesn't default to something generic or text
      mcp: {
        type: "cli",
      },
      auth: {
        OAuth2: {
          token_url: "https://codeberg.org/login/oauth/access_token",
          authorization_url: "https://codeberg.org/login/oauth/authorize",
          scopes: ["repo", "user"],
          scope_separator: ",",
        },
      },
    };
  }
}

function main() {
  const codebergCLI = new CodebergCLI();
  codebergCLI.parse();
}

main();
