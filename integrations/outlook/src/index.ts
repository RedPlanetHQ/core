import {
  IntegrationCLI,
  IntegrationEventPayload,
  IntegrationEventType,
  Spec,
} from '@redplanethq/sdk';

import { integrationCreate } from './account-create';
import { handleSchedule } from './schedule';
import { getTools, callTool } from './mcp';
import { fileURLToPath } from 'url';

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

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
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

class OutlookCLI extends IntegrationCLI {
  constructor() {
    super('outlook', '1.0.0');
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  protected async handleEvent(eventPayload: IntegrationEventPayload): Promise<any> {
    return await run(eventPayload);
  }

  protected async getSpec(): Promise<Spec> {
    return {
      name: 'Outlook extension',
      key: 'outlook',
      description:
        'Connect your workspace to Microsoft Outlook. Monitor emails, manage calendar events, and handle contacts via Microsoft Graph API',
      icon: 'outlook',
      schedule: {
        frequency: '*/15 * * * *',
      },
      auth: {
        OAuth2: {
          token_url: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
          authorization_url: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
          scopes: [
            'openid',
            'profile',
            'email',
            'offline_access',
            'https://graph.microsoft.com/Mail.ReadWrite',
            'https://graph.microsoft.com/Mail.Send',
            'https://graph.microsoft.com/Calendars.ReadWrite',
            'https://graph.microsoft.com/Contacts.ReadWrite',
            'https://graph.microsoft.com/User.Read',
          ],
          scope_identifier: 'scope',
          scope_separator: ' ',
          token_params: {},
          authorization_params: {
            response_type: 'code',
          },
        },
      },
    } as any;
  }
}

function main() {
  const outlookCLI = new OutlookCLI();
  outlookCLI.parse();
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
