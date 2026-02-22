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

class LinkedInCLI extends IntegrationCLI {
  constructor() {
    super("linkedin", "1.0.0");
  }

  protected async handleEvent(eventPayload: IntegrationEventPayload): Promise<any> {
    return await run(eventPayload);
  }

  protected async getSpec(): Promise<Spec> {
    return {
      name: "LinkedIn extension",
      key: "linkedin",
      description:
        "Integrate your LinkedIn professional network with CORE. Sync activities and post updates.",
      icon: "linkedin",
      mcp: {
        type: "cli",
      },
      auth: {
        OAuth2: {
          token_url: "https://www.linkedin.com/oauth/v2/accessToken",
          authorization_url: "https://www.linkedin.com/oauth/v2/authorization",
          scopes: ["openid", "profile", "email", "w_member_social"],
          scope_separator: " ",
        },
      },
    };
  }
}

function main() {
  const linkedinCLI = new LinkedInCLI();
  linkedinCLI.parse();
}

main();
