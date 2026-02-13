import { integrationCreate } from './account-create';
import { handleSchedule } from './schedule';
import {
  IntegrationCLI,
  IntegrationEventPayload,
  IntegrationEventType,
  Spec,
  Message,
} from '@redplanethq/sdk';
import { getTools, callTool } from './mcp';

export async function run(eventPayload: IntegrationEventPayload) {
  switch (eventPayload.event) {
    case IntegrationEventType.SETUP:
      return await integrationCreate(eventPayload.eventBody);

    case IntegrationEventType.SYNC:
      return await handleSchedule(eventPayload.config, eventPayload.state);

    case IntegrationEventType.GET_TOOLS: {
      const tools = await getTools();

      return tools;
    }

    case IntegrationEventType.CALL_TOOL: {
      const integrationDefinition = eventPayload.integrationDefinition;

      if (!integrationDefinition) {
        return null;
      }

      const config = eventPayload.config as any;
      const { name, arguments: args } = eventPayload.eventBody;

      const result = await callTool(
        name,
        args,
        integrationDefinition.config.clientId,
        integrationDefinition.config.clientSecret,
        config?.redirect_uri,
        config
      );

      return result;
    }

    default:
      return { message: `The event payload type is ${eventPayload.event}` };
  }
}

// CLI implementation that extends the base class
class HubSpotCLI extends IntegrationCLI {
  constructor() {
    super('hubspot', '1.0.0');
  }

  protected async handleEvent(eventPayload: IntegrationEventPayload): Promise<any> {
    return await run(eventPayload);
  }

  protected async getSpec(): Promise<Spec> {
    return {
      name: 'HubSpot extension',
      key: 'hubspot',
      description:
        'Connect your workspace to HubSpot. Manage contacts, companies, deals, tickets, and track CRM activities',
      icon: 'hubspot',
      mcp: {
        type: 'cli',
      },
      auth: {
        OAuth2: {
          token_url: 'https://api.hubapi.com/oauth/v1/token',
          authorization_url: 'https://app.hubspot.com/oauth/authorize',
          scopes: [
            'crm.objects.contacts.read',
            'crm.objects.contacts.write',
            'crm.objects.companies.read',
            'crm.objects.companies.write',
            'crm.objects.deals.read',
            'crm.objects.deals.write',
            'tickets',
            'crm.schemas.contacts.read',
            'crm.schemas.companies.read',
            'crm.schemas.deals.read',
          ],
          scope_identifier: 'scope',
          scope_separator: ' ',
          token_params: {
            grant_type: 'authorization_code',
          },
          authorization_params: {},
        },
      },
    };
  }
}

// Define a main function and invoke it directly.
// This works after bundling to JS and running with `node index.js`.
function main() {
  const hubspotCLI = new HubSpotCLI();
  hubspotCLI.parse();
}

main();
