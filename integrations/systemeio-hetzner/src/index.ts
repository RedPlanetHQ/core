import { handleSchedule } from './schedule';
import { integrationCreate } from './account-create';
import {
  IntegrationCLI,
  IntegrationEventPayload,
  IntegrationEventType,
  Spec,
} from '@redplanethq/sdk';
import { callTool, getTools } from './mcp';

export async function run(eventPayload: IntegrationEventPayload) {
  switch (eventPayload.event) {
    case IntegrationEventType.SETUP:
      return await integrationCreate(eventPayload.eventBody);

    case IntegrationEventType.SYNC:
      return await handleSchedule(eventPayload.config, eventPayload.state);

    case IntegrationEventType.GET_TOOLS: {
      try {
        return await getTools();
      } catch (e: any) {
        return [{ type: 'error', data: { message: `Error: ${e.message}` } }];
      }
    }

    case IntegrationEventType.CALL_TOOL: {
      const config = eventPayload.config as any;
      const { name, arguments: args } = eventPayload.eventBody;
      return await callTool(name, args, config);
    }

    default:
      return [{ type: 'error', data: { message: `Unknown event: ${eventPayload.event}` } }];
  }
}

class SystemeioHetznerCLI extends IntegrationCLI {
  constructor() {
    super('systemeio-hetzner', '1.0.0');
  }

  protected async handleEvent(eventPayload: IntegrationEventPayload): Promise<any> {
    return await run(eventPayload);
  }

  protected async getSpec(): Promise<Spec> {
    return {
      name: 'KI-Power Digital Fast Food System',
      key: 'systemeio-hetzner',
      description:
        'Vollautomatisches KI-Business System: Systeme.io Affiliate Marketing + Hetzner Server Auto-Provisioning. Verkauft KI-Server Abos für €99/Monat, provisioniert automatisch Server mit Open WebUI, n8n und vollem KI-Stack. Marketing → Akquisition → Verkauf → Einrichtung → Abrechnung - alles automatisch.',
      icon: 'server',
      category: 'business-automation',
      schedule: {
        frequency: '*/10 * * * *', // Check for new sales every 10 minutes
      },
      mcp: {
        type: 'cli',
      },
      auth: {
        api_key: {
          type: 'object',
          properties: {
            systeme_api_key: {
              type: 'string',
              label: 'Systeme.io API Key',
              description: 'Dein Systeme.io API Key (Settings → API Keys)',
            },
            hetzner_api_token: {
              type: 'string',
              label: 'Hetzner Cloud API Token',
              description: 'Dein Hetzner Cloud API Token (Security → API Tokens)',
            },
          },
        } as any,
      },
    };
  }
}

function main() {
  const cli = new SystemeioHetznerCLI();
  cli.parse();
}

main();
