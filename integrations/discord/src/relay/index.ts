import { fileURLToPath } from 'url';

import { loadConfig } from './config';
import { Forwarder } from './forwarder';
import { GatewayClient } from './gateway-client';

async function main(): Promise<void> {
  const config = loadConfig();

  const forwarder = new Forwarder({
    webhookUrl: config.CORE_WEBHOOK_URL,
    workspaceToken: config.CORE_WORKSPACE_TOKEN,
    relayId: config.CORE_RELAY_ID,
  });

  const gateway = new GatewayClient({
    botToken: config.DISCORD_BOT_TOKEN,
    forwarder,
  });

  const shutdown = async (signal: string) => {
    console.info(`Received ${signal}, shutting down relay`);
    try {
      await gateway.stop();
    } finally {
      process.exit(0);
    }
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  await gateway.start();
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error('Relay startup failed', err);
    process.exit(1);
  });
}
