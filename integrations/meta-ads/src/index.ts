import { integrationCreate } from './account-create';

import {
  IntegrationCLI,
  IntegrationEventPayload,
  IntegrationEventType,
  Spec,
} from '@redplanethq/sdk';
import { callTool, getTools } from './mcp';
import { fileURLToPath } from 'url';

export async function run(eventPayload: IntegrationEventPayload) {
  switch (eventPayload.event) {
    case IntegrationEventType.SETUP:
      return await integrationCreate(eventPayload.eventBody);

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

class MetaAdsCLI extends IntegrationCLI {
  constructor() {
    super('meta-ads', '0.1.0');
  }

  protected async handleEvent(eventPayload: IntegrationEventPayload): Promise<any> {
    return await run(eventPayload);
  }

  protected async getSpec(): Promise<Spec> {
    return {
      name: 'Meta Ads',
      key: 'meta-ads',
      description:
        'Connect your Meta Ads account to manage campaigns, ad sets, ads, and retrieve performance insights across Facebook and Instagram.',
      icon: 'meta-ads',
      mcp: {
        type: 'cli',
      },
      auth: {
        OAuth2: {
          authorization_url: 'https://www.facebook.com/v19.0/dialog/oauth',
          token_url: 'https://graph.facebook.com/v19.0/oauth/access_token',
          scopes: ['ads_read', 'ads_management', 'read_insights'],
          scope_separator: ',',
        },
      },
    };
  }
}

function main() {
  const metaAdsCLI = new MetaAdsCLI();
  metaAdsCLI.parse();
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
