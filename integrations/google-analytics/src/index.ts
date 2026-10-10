import { fileURLToPath } from 'url';

import {
  IntegrationCLI,
  IntegrationEventPayload,
  IntegrationEventType,
  Spec,
} from '@redplanethq/sdk';

import { integrationCreate } from './account-create';
import { getTools, callTool } from './mcp';
import { handleSchedule } from './schedule';

export async function run(eventPayload: IntegrationEventPayload) {
  switch (eventPayload.event) {
    case IntegrationEventType.SETUP:
      return await integrationCreate(eventPayload.eventBody);

    case IntegrationEventType.SYNC:
      return await handleSchedule(
        eventPayload.config,
        eventPayload.integrationDefinition,
        eventPayload.state
      );

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

class GoogleAnalyticsCLI extends IntegrationCLI {
  constructor() {
    super('google-analytics', '1.0.0');
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  protected async handleEvent(eventPayload: IntegrationEventPayload): Promise<any> {
    return await run(eventPayload);
  }

  protected async getSpec(): Promise<Spec> {
    return {
      name: 'Google Analytics',
      key: 'google-analytics',
      description:
        'Connect your workspace to Google Analytics 4. Query reports, monitor real-time traffic, explore dimensions and metrics, and surface 6-hour traffic summaries.',
      icon: 'google-analytics',
      mcp: {
        type: 'cli',
      },
      schedule: {
        // Run every 6 hours to emit a traffic summary activity
        frequency: '0 */6 * * *',
      },
      auth: {
        OAuth2: {
          token_url: 'https://oauth2.googleapis.com/token',
          authorization_url: 'https://accounts.google.com/o/oauth2/v2/auth',
          scopes: [
            'https://www.googleapis.com/auth/analytics.readonly',
            'https://www.googleapis.com/auth/userinfo.email',
            'https://www.googleapis.com/auth/userinfo.profile',
          ],
          scope_identifier: 'scope',
          scope_separator: ' ',
          token_params: {
            access_type: 'offline',
            prompt: 'consent',
          },
          authorization_params: {
            access_type: 'offline',
            prompt: 'consent',
          },
        },
      },
      toolUISupported: true,
    };
  }
}

function main() {
  const cli = new GoogleAnalyticsCLI();
  cli.parse();
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
