import {
  IntegrationCLI,
  IntegrationEventPayload,
  IntegrationEventType,
  Spec,
} from '@redplanethq/sdk';

import { integrationCreate } from './account-create';
import { getTools, callTool } from './mcp';
import { CloudflareConfig } from './utils';
import { fileURLToPath } from 'url';

export async function run(eventPayload: IntegrationEventPayload) {
  switch (eventPayload.event) {
    case IntegrationEventType.SETUP:
      return await integrationCreate(eventPayload.eventBody);

    case IntegrationEventType.GET_TOOLS: {
      return getTools();
    }

    case IntegrationEventType.CALL_TOOL: {
      const config = eventPayload.config as unknown as CloudflareConfig;

      if (!config?.api_token) {
        return {
          content: [{ type: 'text', text: 'Error: No API token provided in config' }],
          isError: true,
        };
      }

      const { name, arguments: args } = eventPayload.eventBody;
      return await callTool(name, args, config);
    }

    default:
      return [
        {
          type: 'message',
          data: { message: `The event payload type is ${eventPayload.event}` },
        },
      ];
  }
}

class CloudflareCLI extends IntegrationCLI {
  constructor() {
    super('cloudflare', '1.0.0');
  }

  protected async handleEvent(eventPayload: IntegrationEventPayload): Promise<any> {
    return await run(eventPayload);
  }

  protected async getSpec(): Promise<Spec> {
    return {
      name: 'Cloudflare',
      key: 'cloudflare',
      description:
        'Connect your Cloudflare account to CORE. Manage DNS records, inspect zone configurations, and purge cache — all from your workspace.',
      icon: 'cloudflare',
      // Cast to allow v2 fields array auth config
      auth: {
        api_key: {
          fields: [
            {
              name: 'api_token',
              label: 'API Token',
              placeholder: 'your-cloudflare-api-token',
              description:
                'Create an API Token in Cloudflare → My Profile → API Tokens. Grant the token Zone:Read and DNS:Edit permissions for the zones you want to manage.',
            },
          ],
        },
      } as any,
    };
  }
}

function main() {
  const cloudflareCLI = new CloudflareCLI();
  cloudflareCLI.parse();
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
