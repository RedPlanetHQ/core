import {
  IntegrationCLI,
  IntegrationEventPayload,
  IntegrationEventType,
  Spec,
} from "@redplanethq/sdk";

import { integrationCreate } from "./account-create";
import { handleSchedule } from "./schedule";
import { getTools, callTool } from "./mcp";
import { PostHogConfig } from "./utils";
import { fileURLToPath } from "url";

export async function run(eventPayload: IntegrationEventPayload) {
  switch (eventPayload.event) {
    case IntegrationEventType.SETUP:
      return await integrationCreate(eventPayload.eventBody);

    case IntegrationEventType.SYNC:
      return await handleSchedule(eventPayload.config, eventPayload.state);

    case IntegrationEventType.GET_TOOLS: {
      return getTools();
    }

    case IntegrationEventType.CALL_TOOL: {
      const config = eventPayload.config as unknown as PostHogConfig;

      if (!config?.api_key) {
        return {
          content: [{ type: "text", text: "Error: No API key provided in config" }],
          isError: true,
        };
      }

      const { name, arguments: args } = eventPayload.eventBody;
      return await callTool(name, args, config);
    }

    default:
      return [
        {
          type: "message",
          data: { message: `The event payload type is ${eventPayload.event}` },
        },
      ];
  }
}

class PostHogCLI extends IntegrationCLI {
  constructor() {
    super("posthog", "1.0.0");
  }

  protected async handleEvent(eventPayload: IntegrationEventPayload): Promise<any> {
    return await run(eventPayload);
  }

  protected async getSpec(): Promise<Spec> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return {
      name: "PostHog",
      key: "posthog",
      description:
        "Connect your PostHog project to CORE. Query analytics events, manage feature flags, explore saved insights, track persons, and annotate your timeline — all from your workspace.",
      icon: "posthog",
      // The SDK's APIKeyParams type doesn't expose `fields`; cast to allow custom auth UI config
      auth: {
        api_key: {
          fields: [
            {
              name: "api_key",
              label: "Personal API Key",
              placeholder: "phx_xxxxxxxxxxxx",
              description:
                "Create a Personal API Key in PostHog → Settings → Personal API Keys. Grant at minimum read access to the project.",
            },
            {
              name: "host",
              label: "PostHog Host",
              placeholder: "https://app.posthog.com",
              description:
                "Base URL of your PostHog instance. Use https://app.posthog.com for US Cloud, https://eu.posthog.com for EU Cloud, or your self-hosted URL.",
            },
          ],
        },
      },
    };
  }
}

function main() {
  const posthogCLI = new PostHogCLI();
  posthogCLI.parse();
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
